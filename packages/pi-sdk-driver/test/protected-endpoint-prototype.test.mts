import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { json } from "node:stream/consumers";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { ModelRuntime, SettingsManager, type AgentSession } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";
import {
  blockReason,
  createProtectedFetch,
  createProtectedEndpointPrototype,
} from "./support/protected-endpoint-prototype.mts";

const selection = { provider: "pi-gui-protected-fixture", modelId: "fixture" };
const dummyKey = "prototype-fixture-model-key";
const normalReply = "Bravo";

async function listen(onRequest: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(onRequest);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

function sendCompletion(response: ServerResponse, requestTool = false) {
  const delta = requestTool
    ? {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: "fixture-call",
            type: "function",
            function: { name: "fixture_echo", arguments: "{}" },
          },
        ],
      }
    : { role: "assistant", content: normalReply };
  const chunk = {
    id: "fixture-reply",
    object: "chat.completion.chunk",
    model: "fixture",
    choices: [{ index: 0, delta, finish_reason: requestTool ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 12000, completion_tokens: 1, total_tokens: 12001 },
  };
  response.writeHead(200, { "content-type": "text/event-stream" });
  response.end(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
}

type Outcome = {
  readonly succeeded: boolean;
  readonly visibleReason?: string | undefined;
};

await test("prototype gates the driver conversation, title, handoff, and their HTTP retries", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-endpoint-prototype-"));
  const agentDir = join(root, "agent");
  const workspace = { workspaceId: "prototype-workspace", path: join(root, "work") };
  await Promise.all([mkdir(agentDir), mkdir(workspace.path)]);
  const oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(async () => {
    if (oldAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = oldAgentDir;
    await rm(root, { force: true, recursive: true });
  });

  let otherRequests = 0;
  const other = await listen((request, response) => {
    otherRequests += 1;
    request.resume();
    sendCompletion(response);
  });
  const received: Array<{
    path: string | undefined;
    authorized: boolean;
    tokens: number | undefined;
  }> = [];
  const receivedBeforeBodyErrors: unknown[] = [];
  let failuresRemaining = 0;
  let redirect = false;
  let redirectWithinOrigin = false;
  let requestTool = false;
  const registered = await listen((request, response) => {
    void json(request)
      .then((value: unknown) => {
        const body = value as { max_tokens?: number; max_completion_tokens?: number };
        received.push({
          path: request.url,
          authorized: request.headers.authorization === `Bearer ${dummyKey}`,
          tokens: body.max_completion_tokens ?? body.max_tokens,
        });
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          response.writeHead(429, { "content-type": "application/json", "retry-after-ms": "1" });
          response.end(JSON.stringify({ error: { message: dummyKey } }));
        } else if (redirect) {
          response.writeHead(307, {
            location: redirectWithinOrigin
              ? `${registered.url}/other/chat/completions?echo=${dummyKey}`
              : `${other.url}/v1/chat/completions?echo=${dummyKey}`,
          });
          response.end();
        } else {
          sendCompletion(response, requestTool);
        }
      })
      .catch((error: unknown) => {
        receivedBeforeBodyErrors.push(error);
        response.destroy();
      });
  });
  t.after(async () => Promise.all([registered.close(), other.close()]));

  const blocked: string[] = [];
  const baseUrl = `${registered.url}/v1`;
  let contextWindow = 128_000;
  const buildRuntime = () =>
    createProtectedEndpointPrototype(
      [
        {
          providerId: selection.provider,
          protect: true,
          baseUrl,
          apiKey: dummyKey,
          models: [
            {
              id: selection.modelId,
              name: "Fixture model",
              input: ["text"],
              reasoning: false,
              cost: { input: 100, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow,
              maxTokens: 4_096,
              promptCache: { short: 12 },
              compat: { maxTokensField: "max_tokens" },
            },
          ],
        },
        {
          providerId: "pi-gui-unprotected-fixture",
          protect: false,
          baseUrl,
          apiKey: dummyKey,
          models: [
            {
              id: "fixture",
              name: "Unprotected fixture",
              input: ["text"],
              reasoning: false,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128_000,
              maxTokens: 4_096,
            },
          ],
        },
      ],
      (_reason, message) => blocked.push(message),
    );

  const originalCreate = ModelRuntime.create.bind(ModelRuntime);
  let activeRuntime: ModelRuntime | undefined;
  let activeSession: AgentSession | undefined;
  let cacheWarming: "off" | "idle" = "off";
  let agentRetry = false;
  let enableFixtureTool = false;
  let fixtureToolCalls = 0;
  let enableGenerationProviderRetry = false;
  let releaseConversation: (() => Promise<void>) | undefined;
  t.mock.method(ModelRuntime, "create", (options?: Parameters<typeof originalCreate>[0]) => {
    // Inject the isolated prototype into the real title/handoff implementation.
    if (options?.authPath === join(agentDir, "auth.json")) {
      assert.ok(activeRuntime);
      return Promise.resolve(activeRuntime);
    }
    return originalCreate(options);
  });
  const inMemorySettings = SettingsManager.inMemory.bind(SettingsManager);
  t.mock.method(
    SettingsManager,
    "inMemory",
    (settings?: Parameters<typeof inMemorySettings>[0]) => {
      if (enableGenerationProviderRetry && settings?.compaction?.enabled === false) {
        return inMemorySettings({
          ...settings,
          retry: { enabled: false, provider: { maxRetries: 1 } },
        });
      }
      return inMemorySettings(settings);
    },
  );
  const driver = new PiSdkDriver({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    createAgentSessionRuntimeImpl: async (options) => {
      assert.ok(activeRuntime);
      const runtime = await createAgentSessionRuntimeWithNpmFallback({
        ...options,
        modelRuntime: activeRuntime,
        tools: enableFixtureTool ? ["fixture_echo"] : [],
        ...(enableFixtureTool
          ? {
              customTools: [
                {
                  name: "fixture_echo",
                  label: "Fixture echo",
                  description: "Return a synthetic value.",
                  parameters: Type.Object({}),
                  execute: () => {
                    fixtureToolCalls += 1;
                    requestTool = false;
                    redirect = true;
                    return Promise.resolve({
                      content: [{ type: "text", text: "Charlie" }],
                      details: {},
                    });
                  },
                },
              ],
            }
          : {}),
        settingsManager: SettingsManager.inMemory({
          cacheWarming,
          compaction: { enabled: false, keepRecentTokens: 20, reserveTokens: 1_000 },
          retry: {
            enabled: agentRetry,
            maxRetries: 1,
            baseDelayMs: 1,
            provider: { maxRetries: agentRetry ? 0 : 1 },
          },
        }),
      });
      activeSession = runtime.session;
      return runtime;
    },
  });

  async function openConversation() {
    const session = await driver.createSession(workspace, { initialModel: selection });
    releaseConversation = () => driver.closeSession(session.ref);
    return async (text: string): Promise<Outcome> => {
      let stop: (() => void) | undefined;
      const awaited = new Promise<Outcome>((resolve) => {
        stop = driver.subscribe(session.ref, (event: SessionDriverEvent) => {
          if (event.type === "runCompleted") resolve({ succeeded: true });
          if (event.type === "runFailed")
            resolve({ succeeded: false, visibleReason: event.error.message });
        });
      });
      try {
        await driver.sendUserMessage(session.ref, { text });
        return await awaited;
      } finally {
        stop?.();
      }
    };
  }

  function reset() {
    received.length = 0;
    blocked.length = 0;
    failuresRemaining = 0;
    redirect = false;
    redirectWithinOrigin = false;
    requestTool = false;
  }

  function assertTraffic(count: number) {
    assert.equal(received.length, count);
    assert.ok(
      received.every((request) => request.authorized && request.path === "/v1/chat/completions"),
    );
    assert.equal(otherRequests, 0);
    assert.equal(receivedBeforeBodyErrors.length, 0);
  }

  for (const route of ["conversation", "title", "handoff"] as const) {
    await t.test(`${route}: registered, changed, redirected, retried`, async (routeTest) => {
      for (const mode of [
        "normal",
        "changed-origin",
        "changed-host",
        "changed-scheme",
        "changed-path",
        "unsupported",
        "redirect",
        "redirect-path",
        "retry",
        "retry-redirect",
        "default-429",
      ] as const) {
        if (mode === "default-429" && route === "conversation") continue;
        await routeTest.test(mode, { timeout: 25_000 }, async (modeTest) => {
          reset();
          activeRuntime = await buildRuntime();
          enableGenerationProviderRetry =
            route !== "conversation" && (mode === "retry" || mode === "retry-redirect");
          if (mode === "changed-origin")
            activeRuntime.registerProvider(selection.provider, { baseUrl: `${other.url}/v1` });
          if (mode === "changed-host") {
            activeRuntime.registerProvider(selection.provider, {
              baseUrl: baseUrl.replace("127.0.0.1", "localhost"),
            });
          }
          if (mode === "changed-scheme")
            activeRuntime.registerProvider(selection.provider, {
              baseUrl: baseUrl.replace("http:", "https:"),
            });
          if (mode === "changed-path")
            activeRuntime.registerProvider(selection.provider, {
              baseUrl: `${registered.url}/other`,
            });
          if (mode === "unsupported")
            activeRuntime.registerProvider(selection.provider, { api: "openai-responses" });
          if (mode === "redirect" || mode === "redirect-path" || mode === "retry-redirect")
            redirect = true;
          if (mode === "redirect-path") redirectWithinOrigin = true;
          if (mode === "retry" || mode === "retry-redirect" || mode === "default-429")
            failuresRemaining = 1;
          try {
            const options = { prompt: "Alpha", model: selection };
            let result: Outcome;
            if (route === "conversation") {
              const send = await openConversation();
              result = await send("Alpha");
            } else {
              const text =
                route === "title"
                  ? await driver.generateThreadTitle(workspace, options)
                  : await driver.generateProjectHandoffDraft(workspace, options);
              result = { succeeded: text === normalReply, visibleReason: blocked.at(-1) };
            }
            const expectedReason =
              mode === "changed-origin" ||
              mode === "changed-host" ||
              mode === "changed-path" ||
              mode === "changed-scheme"
                ? blockReason.destination
                : mode === "unsupported"
                  ? blockReason.transport
                  : mode === "redirect" || mode === "redirect-path" || mode === "retry-redirect"
                    ? blockReason.redirect
                    : undefined;
            assert.equal(
              result.succeeded,
              expectedReason === undefined && mode !== "default-429",
              `${route}/${mode}`,
            );
            if (expectedReason) {
              assert.deepEqual(blocked, [expectedReason]);
              assert.ok(result.visibleReason?.includes(expectedReason));
              assert.equal(result.visibleReason?.includes(dummyKey), false);
              modeTest.diagnostic(expectedReason);
            } else {
              assert.deepEqual(blocked, []);
            }
            assertTraffic(
              mode === "retry" || mode === "retry-redirect"
                ? 2
                : mode === "normal" ||
                    mode === "redirect" ||
                    mode === "redirect-path" ||
                    mode === "default-429"
                  ? 1
                  : 0,
            );
          } finally {
            await releaseConversation?.();
            releaseConversation = undefined;
            enableGenerationProviderRetry = false;
          }
        });
      }
    });
  }

  await t.test(
    "the transport checks the fully constructed request and each endpoint opts in separately",
    async () => {
      reset();
      const runtime = await buildRuntime();
      assert.equal((await runtime.getAuth(selection.provider))?.auth.apiKey === dummyKey, false);
      assert.equal(
        (await runtime.getAuth("pi-gui-unprotected-fixture"))?.auth.apiKey === dummyKey,
        true,
      );
      const dispatch = createProtectedFetch(new URL(baseUrl), dummyKey, (_reason, message) =>
        blocked.push(message),
      );
      for (const url of [
        `${other.url}/v1/chat/completions`,
        `${baseUrl}/chat/completions/extra`,
        `${baseUrl}/chat/completions?extra=1`,
        `${baseUrl.replace("http:", "https:")}/chat/completions`,
      ]) {
        const response = await dispatch(url, { method: "POST" });
        assert.equal(response.status, 400);
        const message = await response.text();
        assert.ok(message.includes(blockReason.destination));
        assert.equal(message.includes(dummyKey), false);
      }
      const unresolved = await dispatch("invalid URL", { method: "POST" });
      assert.equal(unresolved.status, 400);
      assert.ok((await unresolved.text()).includes(blockReason.transport));
      assertTraffic(0);
    },
  );

  await t.test(
    "conversation agent retry stops when the second attempt redirects",
    { timeout: 15_000 },
    async () => {
      reset();
      agentRetry = true;
      failuresRemaining = 1;
      redirect = true;
      activeRuntime = await buildRuntime();
      try {
        const send = await openConversation();
        const result = await send("Alpha");
        assert.equal(result.succeeded, false);
        assert.ok(result.visibleReason?.includes(blockReason.redirect));
        assert.equal(result.visibleReason?.includes(dummyKey), false);
        assert.deepEqual(blocked, [blockReason.redirect]);
        assertTraffic(2);
      } finally {
        await releaseConversation?.();
        releaseConversation = undefined;
        agentRetry = false;
      }
    },
  );

  await t.test(
    "continuation after a tool reply cannot follow a redirect",
    { timeout: 15_000 },
    async () => {
      reset();
      enableFixtureTool = true;
      requestTool = true;
      activeRuntime = await buildRuntime();
      try {
        const send = await openConversation();
        const outcome = await send("Alpha");
        assert.equal(fixtureToolCalls, 1);
        assert.equal(outcome.succeeded, false);
        assert.ok(outcome.visibleReason?.includes(blockReason.redirect));
        assert.deepEqual(blocked, [blockReason.redirect]);
        assertTraffic(2);
      } finally {
        await releaseConversation?.();
        releaseConversation = undefined;
        enableFixtureTool = false;
      }
    },
  );

  await t.test(
    "conversation cache warming uses the same protected transport",
    { timeout: 15_000 },
    async () => {
      reset();
      cacheWarming = "idle";
      activeRuntime = await buildRuntime();
      try {
        const send = await openConversation();
        const reply = await send("Alpha");
        assert.equal(reply.succeeded, true);
        assertTraffic(1);
        const signal = AbortSignal.timeout(10_000);
        while (received.length < 2) await delay(20, undefined, { signal });
        assert.equal(received[1]?.tokens, 1);
        assertTraffic(2);
        redirect = true;
        while (blocked.length === 0) await delay(20, undefined, { signal });
        assert.deepEqual(blocked, [blockReason.redirect]);
        assert.equal(received[2]?.tokens, 1);
        assertTraffic(3);
      } finally {
        await releaseConversation?.();
        releaseConversation = undefined;
        cacheWarming = "off";
      }
    },
  );

  await t.test(
    "conversation compaction blocks a redirect after a successful summary",
    { timeout: 15_000 },
    async () => {
      reset();
      activeRuntime = await buildRuntime();
      try {
        const send = await openConversation();
        const session = activeSession;
        assert.ok(session);
        for (const text of ["Alpha", "Charlie", "Delta"]) {
          assert.equal((await send(text.repeat(100))).succeeded, true);
        }
        assertTraffic(3);
        await session.compact();
        assertTraffic(4);
        for (const text of ["Echo", "Foxtrot"]) {
          assert.equal((await send(text.repeat(100))).succeeded, true);
        }
        redirect = true;
        await assert.rejects(session.compact(), (error: unknown) => {
          assert.ok(error instanceof Error && error.message.includes(blockReason.redirect));
          assert.equal(error.message.includes(dummyKey), false);
          return true;
        });
        assert.deepEqual(blocked, [blockReason.redirect]);
        assertTraffic(7);
      } finally {
        await releaseConversation?.();
        releaseConversation = undefined;
      }
    },
  );

  await t.test("conversation branch summary blocks a redirect", { timeout: 15_000 }, async () => {
    reset();
    activeRuntime = await buildRuntime();
    try {
      const send = await openConversation();
      const session = activeSession;
      assert.ok(session);
      assert.equal((await send("Alpha")).succeeded, true);
      assert.equal((await send("Charlie")).succeeded, true);
      const target = session.getUserMessagesForForking()[0];
      assert.ok(target);
      redirect = true;
      await assert.rejects(
        session.navigateTree(target.entryId, { summarize: true }),
        (error: unknown) => {
          assert.ok(error instanceof Error && error.message.includes(blockReason.redirect));
          assert.equal(error.message.includes(dummyKey), false);
          return true;
        },
      );
      assert.deepEqual(blocked, [blockReason.redirect]);
      assertTraffic(3);
      redirect = false;
      const result = await session.navigateTree(target.entryId, { summarize: true });
      assert.ok(result.summaryEntry?.summary.includes(normalReply));
      assertTraffic(4);
    } finally {
      await releaseConversation?.();
      releaseConversation = undefined;
    }
  });

  await t.test("automatic compaction cannot follow a redirect", { timeout: 15_000 }, async () => {
    reset();
    contextWindow = 12_500;
    activeRuntime = await buildRuntime();
    try {
      const send = await openConversation();
      const session = activeSession;
      assert.ok(session);
      for (const text of ["Alpha", "Charlie", "Delta"]) {
        assert.equal((await send(text.repeat(100))).succeeded, true);
      }
      const compactionErrors: string[] = [];
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "compaction_end" && event.reason !== "manual" && event.errorMessage) {
          compactionErrors.push(event.errorMessage);
        }
      });
      try {
        redirect = true;
        session.settingsManager.setCompactionEnabled(true);
        assert.equal((await send("Echo")).succeeded, false);
        assert.ok(compactionErrors.some((error) => error.includes(blockReason.redirect)));
        assert.ok(compactionErrors.every((error) => !error.includes(dummyKey)));
        assert.ok(
          blocked.length > 0 && blocked.every((message) => message === blockReason.redirect),
        );
        assertTraffic(3 + blocked.length);
      } finally {
        unsubscribe();
      }
    } finally {
      await releaseConversation?.();
      releaseConversation = undefined;
      contextWindow = 128_000;
    }
  });
});
