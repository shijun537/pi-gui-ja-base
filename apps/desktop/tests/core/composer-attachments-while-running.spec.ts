import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  pasteTinyPng,
  seedAgentDir,
  setDesktopTestLocale,
} from "../helpers/electron-app";
import { startHangingOpenAiServer } from "../helpers/hanging-openai-server";

// The submit IPC resolves only when the agent turn ends. The composer used to hide every
// attachment until then, so an image pasted during a run was stored and sent but never shown.
test("shows an image pasted while the thread is running", async () => {
  test.setTimeout(60_000);
  const server = await startHangingOpenAiServer();
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspacePath = await makeWorkspace("composer-attachments-while-running");
  await seedAgentDir(agentDir, {
    withOpenAiAuth: false,
    withDefaultModel: false,
    enabledModels: ["slow-test/slow"],
  });
  await writeFile(
    join(agentDir, "settings.json"),
    `${JSON.stringify(
      {
        defaultProvider: "slow-test",
        defaultModel: "slow",
        defaultThinkingLevel: "off",
        enabledModels: ["slow-test/slow"],
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    join(agentDir, "models.json"),
    `${JSON.stringify(
      {
        providers: {
          "slow-test": {
            baseUrl: server.baseUrl,
            api: "openai-completions",
            apiKey: "unused",
            models: [{ id: "slow", input: ["text", "image"] }],
          },
        },
      },
      null,
      2,
    )}\n`,
  );
  const harness = await launchDesktop(userDataDir, {
    agentDir,
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await setDesktopTestLocale(window, "ja");
    await window
      .locator("#primary-sidebar")
      .getByRole("button", { name: "新しい会話", exact: true })
      .click();
    await expect(window.getByRole("textbox", { name: "新しい会話の入力欄" })).toBeVisible();
    await expect(window.getByRole("button", { name: "会話を開始" })).toBeDisabled();
    await createNamedThread(window, "Paste while running");
    const composer = window.getByTestId("composer");
    const attachments = window.locator(".composer-attachment--image");
    await expect(composer).toHaveAccessibleName("会話の入力欄");
    await expect(window.getByText("会話を始める", { exact: true })).toBeVisible();
    await expect(window.getByRole("button", { name: "ファイルを添付" })).toBeVisible();
    await expect(
      window.locator(".composer").getByRole("button", { name: "オフ", exact: true }),
    ).toBeVisible();
    await window.getByRole("button", { name: "slow-test:slow" }).click();
    await expect(window.getByPlaceholder("モデルを検索…")).toBeVisible();
    await window.getByPlaceholder("モデルを検索…").fill("not-a-model");
    await expect(window.getByText("該当するモデルがありません")).toBeVisible();
    await window.keyboard.press("Escape");
    await composer.fill("/thinking");
    await expect(window.getByTestId("slash-options-menu")).toContainText("応答速度を優先します");
    await composer.fill("/tree alpha");
    await window.getByRole("button", { name: "メッセージを送信" }).click();
    await expect(window.getByTestId("composer-error-banner")).toHaveText(
      "/tree の後に文字を付けずに実行してください。",
    );
    await composer.fill("");

    await pasteTinyPng(window, "sent-with-first-prompt.png");
    await expect(attachments).toHaveCount(1);
    await composer.fill("Look at this screenshot");
    await window.getByRole("button", { name: "メッセージを送信" }).click();

    // The sent image leaves the composer at once, while the turn is still in flight.
    await expect(attachments).toHaveCount(0);
    await expect.poll(() => server.pendingRequestCount()).toBeGreaterThan(0);
    await expect
      .poll(async () => {
        const state = await getDesktopState(window);
        const workspace = state.workspaces.find((entry) => entry.id === state.selectedWorkspaceId);
        return workspace?.sessions.find((entry) => entry.id === state.selectedSessionId)?.status;
      })
      .toBe("running");
    await expect(window.getByRole("button", { name: "実行を停止" })).toBeVisible();
    await expect(window.getByTestId("timeline-working")).toContainText("作業中");

    await pasteTinyPng(window, "pasted-during-run.png");
    await expect
      .poll(async () => (await getDesktopState(window)).composerAttachments.map((a) => a.name))
      .toEqual(["pasted-during-run.png"]);
    await expect(attachments).toHaveCount(1);
    await expect(
      attachments.getByRole("button", { name: "pasted-during-run.png を添付から外す" }),
    ).toBeVisible();

    // The next message, queued behind the running turn, takes the image with it.
    await composer.fill("And this one");
    await composer.press("Enter");
    await expect
      .poll(async () =>
        (await getDesktopState(window)).queuedComposerMessages.map((message) => ({
          text: message.text,
          attachments: message.attachments.map((attachment) => attachment.name),
        })),
      )
      .toEqual([{ text: "And this one", attachments: ["pasted-during-run.png"] }]);
    await expect(attachments).toHaveCount(0);
    expect((await getDesktopState(window)).composerAttachments).toEqual([]);

    await window
      .getByRole("button", { name: "送信待ちのメッセージ「And this one」を削除" })
      .click();
    await expect(window.getByTestId("queued-composer-message")).toHaveCount(0);
    await window.getByRole("button", { name: "実行を停止" }).click();
    await expect(window.getByTestId("timeline-working")).toHaveCount(0);
  } finally {
    await harness.close();
    await server.close();
  }
});
