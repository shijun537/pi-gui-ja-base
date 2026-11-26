import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  seedAgentDir,
  selectSession,
  setDesktopTestLocale,
} from "../helpers/electron-app";
import { startScriptedOpenAiServer } from "../helpers/scripted-openai-server";

test("project permissions retain history and gate each protected tool call", async () => {
  test.setTimeout(150_000);
  const userDataDir = await makeUserDataDir();
  const agentDir = join(userDataDir, "agent");
  const workspace = await makeWorkspace("approval　fixture");
  const title = "Approval fixture";
  const marker = join(agentDir, "extension-loaded.txt");
  const outside = join(userDataDir, "outside.txt");
  const isPresent = (name: string) =>
    access(name).then(
      () => true,
      () => false,
    );
  const server = await startScriptedOpenAiServer(({ messages }) => {
    switch (messages.at(-1)?.content) {
      case "Read the README.":
        return { tool: "read", args: { path: "README.md" } };
      case "Try a denied write.":
        return { tool: "write", args: { path: "denied.txt", content: "Discard" } };
      case "Try an approved write.":
        return { tool: "write", args: { path: "approved.txt", content: "Approved" } };
      case "Run a command that needs approval.":
        return {
          tool: "powershell",
          args: { command: "Set-Content -LiteralPath denied-command.txt -Value 'Fixture'" },
        };
      case "Run an approved command.":
        return {
          tool: "powershell",
          args: { command: "Set-Content -LiteralPath approved-command.txt -Value 'Fixture'" },
        };
      case "Read outside the project.":
        return { tool: "read", args: { path: outside } };
      default:
        return { text: "Fixture done." };
    }
  });
  const launch = () =>
    launchDesktop(userDataDir, {
      agentDir,
      initialWorkspaces: [workspace],
      testMode: "background",
    });
  const choose = async (page: Page, label: string) => {
    await page.locator(".project-approval__picker summary").click();
    await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await expect(
      page.getByRole("status", { name: "" }).filter({ hasText: `再起動後に「${label}」を適用` }),
    ).toBeVisible();
  };
  const send = async (page: Page, prompt: string) => {
    const composer = page.getByTestId("composer");
    await composer.fill(prompt);
    await composer.press("Enter");
  };
  try {
    await writeFile(outside, "Outside file sentinel");
    await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({
        defaultProvider: "scripted-test",
        defaultModel: "scripted",
        enabledModels: ["scripted-test/scripted"],
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
            models: [{ id: "scripted" }],
          },
        },
      }),
    );
    await mkdir(join(agentDir, "extensions"));
    await writeFile(
      join(agentDir, "extensions", "test.ts"),
      `import { writeFileSync } from 'node:fs';
export default function () { writeFileSync(${JSON.stringify(marker)}, 'loaded'); }
`,
    );
    let app = await launch();
    try {
      let page = await app.firstWindow();
      await setDesktopTestLocale(page, "ja");
      await createNamedThread(page, title);
      await send(page, "Fixture history.");
      await expect(page.getByTestId("transcript")).toContainText("Fixture done.");
      await expect.poll(() => isPresent(marker)).toBe(true);
      await choose(page, "読むだけ");
      await app.close();
      await rm(marker, { force: true });

      app = await launch();
      page = await app.firstWindow();
      await selectSession(page, title);
      await expect(page.locator(".project-approval__picker summary")).toHaveText("読むだけ");
      await expect(page.getByTestId("transcript")).toContainText("Fixture history.");
      await send(page, "Read the README.");
      await expect(page.getByText("Fixture done.", { exact: true })).toHaveCount(2);
      const request = server.requests.find(
        (entry) => entry.messages.at(-1)?.content === "Read the README.",
      );
      expect([...(request?.toolNames ?? [])].sort()).toEqual(["find", "grep", "ls", "read"]);
      expect(
        server.requests.some((entry) =>
          entry.messages.at(-1)?.content.includes("# approval　fixture"),
        ),
      ).toBe(true);
      await send(page, "Read outside the project.");
      await expect(page.getByText("Fixture done.", { exact: true })).toHaveCount(3);
      expect(
        server.requests.some((entry) =>
          entry.messages.at(-1)?.content.includes("Outside file sentinel"),
        ),
      ).toBe(false);
      expect(await isPresent(marker)).toBe(false);
      await choose(page, "確認して作業");
      await app.close();

      app = await launch();
      page = await app.firstWindow();
      await selectSession(page, title);
      await expect(page.locator(".project-approval__picker summary")).toHaveText("確認して作業");
      await send(page, "Try a denied write.");
      const dialog = page.getByRole("dialog", { name: "このファイルの変更を許可しますか？" });
      await expect(dialog).toContainText("denied.txt");
      expect(await isPresent(join(workspace, "denied.txt"))).toBe(false);
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("send")).toHaveAccessibleName("メッセージを送信");
      expect(await isPresent(join(workspace, "denied.txt"))).toBe(false);

      await send(page, "Try an approved write.");
      await expect(dialog).toContainText("approved.txt");
      expect(await isPresent(join(workspace, "approved.txt"))).toBe(false);
      await dialog.getByRole("button", { name: "許可する", exact: true }).click();
      await expect
        .poll(() => readFile(join(workspace, "approved.txt"), "utf8").catch(() => ""))
        .toBe("Approved");
      expect(await isPresent(marker)).toBe(false);
      if (process.platform === "win32") {
        await expect(page.getByTestId("send")).toHaveAccessibleName("メッセージを送信");
        await send(page, "Run a command that needs approval.");
        const command = page.getByRole("dialog", { name: "このコマンドの実行を許可しますか？" });
        await expect(command).toContainText("Set-Content -LiteralPath denied-command.txt");
        await command.getByRole("button", { name: "許可しない", exact: true }).click();
        await expect(page.getByTestId("send")).toHaveAccessibleName("メッセージを送信");
        expect(await isPresent(join(workspace, "denied-command.txt"))).toBe(false);
        await send(page, "Run an approved command.");
        await expect(command).toContainText("Set-Content -LiteralPath approved-command.txt");
        expect(await isPresent(join(workspace, "approved-command.txt"))).toBe(false);
        await command.getByRole("button", { name: "許可する", exact: true }).click();
        await expect
          .poll(() =>
            readFile(join(workspace, "approved-command.txt"), "utf8").then(
              (result) => result.trim(),
              () => "",
            ),
          )
          .toBe("Fixture");
      }
    } finally {
      await app.close();
    }
  } finally {
    await server.close();
  }
});
