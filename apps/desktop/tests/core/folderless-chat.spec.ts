import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  setDesktopTestLocale,
  stubNextOpenDialog,
} from "../helpers/electron-app";
import { startScriptedOpenAiServer } from "../helpers/scripted-openai-server";

test("starts a chat without projects and resumes it from history without project tools", async () => {
  test.setTimeout(120_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const firstPrompt = "Write a short greeting.";
  const nextPrompt = "Make that greeting more formal.";
  const stopPrompt = "Wait for a stop signal.";
  const draft = "Summary: a greeting. Task: prepare a formal greeting.";
  const editedDraft = "Approved: prepare a formal greeting in the project.";
  const projectPath = await makeWorkspace("continue-chat-project");
  const server = await startScriptedOpenAiServer((request) => {
    const prompt = request.messages.at(-1)?.content;
    if (prompt === stopPrompt) return { waitForAbort: true };
    if (prompt?.startsWith("Prepare an editable project handoff")) return { text: draft };
    if (prompt === editedDraft) return { text: "Project task started." };
    if (prompt?.includes(editedDraft)) return { text: "Project work" };
    return { text: prompt === nextPrompt ? "Good morning." : "Hello there." };
  });
  await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
  await writeFile(
    join(agentDir, "settings.json"),
    JSON.stringify({
      defaultProvider: "scripted-test",
      defaultModel: "scripted",
      enabledModels: ["scripted-test/scripted", "scripted-test/alternate"],
    }),
  );
  await writeFile(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        "scripted-test": {
          baseUrl: server.baseUrl,
          api: "openai-completions",
          apiKey: "unused",
          models: [{ id: "scripted" }, { id: "alternate", name: "Alternate model" }],
        },
      },
    }),
  );
  const launch = () =>
    launchDesktop(userDataDir, { agentDir, scrubProviderEnv: true, testMode: "background" });
  try {
    const first = await launch();
    try {
      const window = await first.firstWindow();
      await setDesktopTestLocale(window, "ja");
      expect((await getDesktopState(window)).workspaces).toHaveLength(0);
      await window.getByRole("button", { name: "チャット", exact: true }).click();
      await expect(
        window.getByRole("heading", { name: "フォルダを選ばずに相談できます" }),
      ).toBeVisible();
      await window.screenshot({ path: test.info().outputPath("folderless-japanese.png") });
      const initialComposer = window.getByTestId("new-thread-composer");
      await initialComposer.fill(firstPrompt);
      await initialComposer.press("Enter");
      await expect(window.getByTestId("transcript")).toContainText("Hello there.");
      const row = window.getByTestId("workspace-list").locator(".session-row").first();
      await row.click({ button: "right" });
      await row.getByRole("button", { name: "会話をピン留め", exact: true }).click();
      await expect(window.getByRole("region", { name: "ピン留めした会話" })).toBeVisible();
      await expect(window.getByTestId("toggle-side-panel")).toHaveCount(0);
      expect((await getDesktopState(window)).workspaces.map((workspace) => workspace.kind)).toEqual(
        ["chat"],
      );
    } finally {
      await first.close();
    }

    const second = await launch();
    try {
      const window = await second.firstWindow();
      const pinned = window.getByRole("region", { name: "ピン留めした会話" });
      const row = pinned.locator(".session-row");
      await row.click();
      const transcript = window.getByTestId("transcript");
      await expect(transcript).toContainText(firstPrompt);
      await row.click({ button: "right" });
      await row.getByRole("button", { name: "会話のピン留めを解除", exact: true }).click();
      await expect(pinned).toHaveCount(0);
      await window.getByTestId("workspace-list").locator(".session-row").first().click();
      await expect(transcript).toContainText(firstPrompt);
      const composer = window.getByTestId("composer");
      const send = window.getByRole("button", { name: "メッセージを送信", exact: true });
      await composer.fill(nextPrompt);
      const footer = window.locator(".composer__bar");
      await footer.getByRole("button", { name: "scripted-test:scripted" }).click();
      await footer.getByRole("button", { name: "Alternate model" }).click();
      await expect(composer).toHaveValue(nextPrompt);
      await expect(send).toBeEnabled();
      await send.click();
      await expect
        .poll(async () => ({
          requestSent: server.requests.some(
            (entry) => entry.messages.at(-1)?.content === nextPrompt && entry.model === "alternate",
          ),
          error: (await getDesktopState(window)).lastError,
        }))
        .toEqual({ requestSent: true, error: undefined });
      await expect(transcript).toContainText("Good morning.");
      await composer.fill(stopPrompt);
      await composer.press("Enter");
      await expect
        .poll(() => server.requests.some((entry) => entry.messages.at(-1)?.content === stopPrompt))
        .toBe(true);
      const stop = window.getByRole("button", { name: "実行を停止", exact: true });
      await stop.click();
      await expect(stop).toHaveCount(0);
      for (const prompt of [firstPrompt, nextPrompt]) {
        const request = server.requests.find(
          (entry) =>
            entry.messages.some(
              (message) => message.role === "user" && message.content === prompt,
            ) && entry.messages.at(-1)?.content === prompt,
        );
        expect(request?.toolNames).toEqual([]);
      }

      const sourceId = (await getDesktopState(window)).selectedSessionId;
      const continueButton = window.getByRole("button", {
        name: "プロジェクトで続ける",
        exact: true,
      });
      await continueButton.click();
      const dialog = window.getByRole("dialog", { name: "プロジェクトで続ける" });
      await stubNextOpenDialog(second, [projectPath]);
      await dialog.getByRole("button", { name: "別のフォルダを開く" }).click();
      const prepare = dialog.getByRole("button", { name: "AI で要点を下書き" });
      await expect(prepare).toBeEnabled();
      await dialog.getByRole("button", { name: "キャンセル" }).click();
      await expect(transcript).toContainText("Good morning.");
      expect((await getDesktopState(window)).selectedSessionId).toBe(sourceId);
      expect(server.requests.some((entry) => entry.messages.at(-1)?.content === editedDraft)).toBe(
        false,
      );

      await continueButton.click();
      await prepare.click();
      const draftBox = dialog.getByRole("textbox", { name: "引き継ぐ下書き" });
      await expect(draftBox).toHaveValue(draft);
      await window.screenshot({ path: test.info().outputPath("project-handoff-japanese.png") });
      await draftBox.fill(editedDraft);
      await dialog.getByRole("button", { name: "プロジェクトに送信" }).click();
      await expect(dialog).toHaveCount(0);
      await expect(transcript).toContainText("Project task started.");
      const state = await getDesktopState(window);
      expect(
        state.workspaces.find((workspace) => workspace.id === state.selectedWorkspaceId)?.path,
      ).toBe(projectPath);
      expect(state.selectedSessionId).not.toBe(sourceId);
      const sent = server.requests.find((entry) => entry.messages.at(-1)?.content === editedDraft);
      expect(sent?.toolNames).toContain("read");
      await window
        .getByTestId("workspace-list")
        .locator(".session-row")
        .filter({ hasText: "Hello there" })
        .click();
      await expect(transcript).toContainText("Good morning.");
      await expect(transcript).not.toContainText(editedDraft);
    } finally {
      await second.close();
    }
  } finally {
    await server.close();
  }
});
