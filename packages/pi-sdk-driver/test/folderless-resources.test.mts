import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { createAgentSessionRuntimeWithNpmFallback } from "../dist/npm-package-fallback.js";
import { PiSdkDriver } from "../dist/pi-sdk-driver.js";

await test("a folderless conversation omits project tools and extensions on create, reload and reopen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "pi-gui-folderless-"));
  const agentDir = join(root, "agent");
  const chat = { workspaceId: "test-chat", path: join(root, "chat") };
  const project = { workspaceId: "test-project", path: join(root, "project") };
  await Promise.all([mkdir(agentDir), mkdir(chat.path), mkdir(project.path)]);
  await writeFile(join(agentDir, "auth.json"), "{}");
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({ packages: [], cacheWarming: "off" }),
  );
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("This test must never use the network");
  });
  const sessions = new Map<string, AgentSessionRuntime>();
  let extensionLoads = 0;
  const driver = new PiSdkDriver({
    agentDir,
    catalogFilePath: join(root, "catalogs.json"),
    folderlessWorkspaceId: chat.workspaceId,
    builtinExtensions: [
      {
        name: "test extension",
        factory: () => {
          extensionLoads += 1;
        },
      },
    ],
    createAgentSessionRuntimeImpl: async (options) => {
      const runtime = await createAgentSessionRuntimeWithNpmFallback(options);
      if (options?.cwd) sessions.set(options.cwd, runtime);
      return runtime;
    },
  });

  const projectSession = await driver.createSession(project);
  assert.ok(sessions.get(project.path)?.session.getActiveToolNames().includes("read"));
  assert.ok(extensionLoads > 0);
  const projectLoads = extensionLoads;
  await driver.closeSession(projectSession.ref);

  const chatSession = await driver.createSession(chat);
  const chatTools = () => sessions.get(chat.path)?.session.getActiveToolNames();
  assert.deepEqual(chatTools(), []);
  const inventory = await driver.runtimeSupervisor.getRuntimeSnapshot(chat);
  assert.deepEqual(inventory.skills, []);
  assert.deepEqual(inventory.extensions, []);
  await driver.reloadSession(chatSession.ref);
  assert.deepEqual(chatTools(), []);
  await driver.closeSession(chatSession.ref);
  await driver.openSession(chatSession.ref);
  assert.deepEqual(chatTools(), []);
  assert.equal(extensionLoads, projectLoads);
  await driver.closeSession(chatSession.ref);
});
