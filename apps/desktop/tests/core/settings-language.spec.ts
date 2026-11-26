import { basename } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { resolveLocale } from "../../src/i18n/preference";
import { translatorFor } from "../../src/i18n/translate";
import {
  type DesktopHarness,
  createNamedThread,
  desktopShortcut,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  setDesktopTestLocale,
  stubNextOpenDialog,
} from "../helpers/electron-app";

const english = translatorFor("en");
const chinese = translatorFor("zh-CN");
const japanese = translatorFor("ja");

async function openAppearance(window: Page) {
  await window.keyboard.press(desktopShortcut(","));
  const surface = window.getByTestId("settings-surface");
  await expect(surface).toBeVisible();
  await surface.getByRole("button", { name: /^(Appearance|外观|外観)$/ }).click();
  return surface;
}

function languagePicker(window: Page) {
  return window.getByRole("combobox", { name: /^(Language|语言|言語)$/ });
}

async function openSecondWindow(harness: DesktopHarness): Promise<Page> {
  const existing = new Set(harness.electronApp.windows());
  // The app's native New Window shortcut is handled in before-input-event.
  await harness.electronApp.evaluate(
    ({ BrowserWindow }, modifier) => {
      BrowserWindow.getAllWindows()[0]?.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "n",
        modifiers: [modifier, "shift"],
      });
    },
    process.platform === "darwin" ? "meta" : "control",
  );
  await expect.poll(() => harness.electronApp.windows().length).toBe(existing.size + 1);
  const opened = harness.electronApp.windows().find((candidate) => !existing.has(candidate));
  if (!opened) throw new Error("Expected New Window to create a second desktop window");
  await opened.waitForLoadState("domcontentloaded");
  return opened;
}

test("Settings switches to Simplified Chinese and back, and the choice survives a restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-language");
  const launch = () => launchDesktop(userDataDir, { initialWorkspaces: [workspacePath] });

  const firstRun = await launch();
  try {
    const window = await firstRun.firstWindow();
    const surface = await openAppearance(window);

    // Until the user picks one, the language follows the OS.
    await expect(languagePicker(window)).toHaveValue("system");
    const systemLanguages = await window.evaluate(() => [...navigator.languages]);
    const systemLocale = resolveLocale("system", systemLanguages);
    await expect(window.locator("html")).toHaveAttribute("lang", systemLocale);

    await languagePicker(window).selectOption("zh-CN");
    await expect(window.locator("html")).toHaveAttribute("lang", "zh-CN");
    // The page re-renders in place: header, navigation and controls, no restart.
    await expect(
      surface.getByRole("heading", { name: chinese("settings.nav.appearance") }),
    ).toBeVisible();
    await expect(
      surface.getByRole("button", { name: chinese("settings.nav.providers") }),
    ).toBeVisible();
    await expect(surface).toContainText(chinese("settings.appearance.transparency.title"));
    await expect(surface).not.toContainText(english("settings.appearance.transparency.title"));

    // Other pages read Chinese too.
    await surface.getByRole("button", { name: chinese("settings.nav.notifications") }).click();
    await expect(
      surface.getByRole("heading", { name: chinese("settings.nav.notifications") }),
    ).toBeVisible();
    await surface.getByRole("button", { name: chinese("settings.nav.appearance") }).click();
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    await expect(window.locator("html")).toHaveAttribute("lang", "zh-CN");
    const surface = await openAppearance(window);
    await expect(languagePicker(window)).toHaveValue("zh-CN");
    await expect(surface).toContainText(chinese("settings.appearance.transparency.title"));

    // Back to English: an explicit choice wins over the OS language.
    await languagePicker(window).selectOption("en");
    await expect(window.locator("html")).toHaveAttribute("lang", "en");
    await expect(surface.getByRole("heading", { name: "Appearance" })).toBeVisible();
    await expect(surface).toContainText("Window transparency");
    await expect(surface).not.toContainText(chinese("settings.appearance.transparency.title"));
  } finally {
    await secondRun.close();
  }
});

test("Japanese Settings renders endpoint guidance with natural word order and punctuation", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-japanese");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const surface = await openAppearance(window);
    await languagePicker(window).selectOption("ja");
    await expect(window.locator("html")).toHaveAttribute("lang", "ja");
    await expect(surface.getByRole("heading", { name: "外観" })).toBeVisible();
    await surface.getByRole("button", { name: japanese("settings.nav.providers") }).click();
    await surface.getByRole("button", { name: japanese("ui.addEndpoint") }).click();
    const dialog = window.getByTestId("custom-endpoint-dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator(".extension-dialog__body")).toHaveText(
      "OpenAI 互換サーバーを設定します。エンドポイントと API キーを平文で保存するファイルは ~/.pi/agent/models.json です。",
    );
    await expect(
      dialog.locator(".settings-row__description").filter({ hasText: "vLLM は" }),
    ).toHaveText(
      "末尾に /v1 を付けてください。例: Ollama は http://localhost:11434/v1、vLLM は http://localhost:8000/v1。",
    );
    await expect(
      dialog.locator(".settings-row__description").filter({ hasText: "保存形式上必要" }),
    ).toHaveText(
      "保存形式上必要な項目です。vLLM の起動時に --api-key を指定した場合は、そのキーを入力してください。認証のない Ollama などは空欄にするとプレースホルダーが保存されます。",
    );
  } finally {
    await harness.close();
  }
});

test("Japanese covers the startup workspace and sidebar folder and pin actions", async ({}, testInfo) => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("sidebar-locale");
  const launch = () =>
    launchDesktop(userDataDir, { scrubProviderEnv: true, testMode: "background" });
  const firstRun = await launch();
  try {
    const window = await firstRun.firstWindow();
    const sidebar = window.locator("#primary-sidebar");
    const system = translatorFor(
      resolveLocale("system", await window.evaluate(() => [...navigator.languages])),
    );
    await expect(
      window.getByRole("heading", { name: system("workspace.start.title") }),
    ).toBeVisible();
    await sidebar.getByRole("button", { name: system("settings.title"), exact: true }).click();
    const settings = window.getByTestId("settings-surface");
    await settings.getByRole("button", { name: system("settings.nav.appearance") }).click();
    await languagePicker(window).selectOption("ja");
    await settings.getByRole("button", { name: "一般", exact: true }).click();
    await expect(settings.getByText(/会話を始めるときに使う AI/)).toBeVisible();
    await expect(settings.getByText(/会話の入力欄で「\/」を入力して/)).toBeVisible();
    const modelScope = settings.getByRole("combobox", { name: "モデル設定の適用範囲" });
    await expect(modelScope).toHaveValue("app-global");
    await expect(modelScope.getByRole("option")).toHaveText(["アプリ全体", "リポジトリごと"]);
    await modelScope.selectOption("per-repo");
    await expect(modelScope).toHaveValue("per-repo");
    await modelScope.selectOption("app-global");
    await expect(modelScope).toHaveValue("app-global");

    await settings.getByRole("button", { name: "スキルと拡張機能", exact: true }).click();
    const skills = window.getByTestId("skills-surface");
    await expect(skills.getByRole("heading", { name: "スキルと拡張機能" })).toBeVisible();
    await expect(skills.getByRole("searchbox", { name: "スキルを検索" })).toBeVisible();
    await expect(skills.getByText("最初にフォルダを開いてください")).toBeVisible();
    await skills.getByRole("tab", { name: /^拡張機能/ }).click();
    const extensions = window.getByTestId("extensions-surface");
    await expect(extensions.getByRole("searchbox", { name: "拡張機能を検索" })).toBeVisible();
    await extensions.getByRole("button", { name: "アプリに戻る" }).click();

    await expect(window.getByRole("heading", { name: "フォルダを開いて始める" })).toBeVisible();
    const topbarTitle = window.getByTestId("topbar").getByText("フォルダを開いて始める");
    await expect(topbarTitle).toBeVisible();
    expect(
      await topbarTitle.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const emptyState = sidebar.getByTestId("empty-state");
    await expect(emptyState.getByRole("heading", { name: "フォルダがありません" })).toBeVisible();
    const openFolder = emptyState.getByRole("button", { name: "最初のフォルダを開く" });
    const gap = await emptyState.evaluate((card) => {
      const description = card.querySelector("p")?.getBoundingClientRect();
      const button = card.querySelector("button")?.getBoundingClientRect();
      return description && button ? button.top - description.bottom : 0;
    });
    expect(gap).toBeGreaterThanOrEqual(8);
    await openFolder.screenshot({ path: testInfo.outputPath("first-folder-button.png") });

    await stubNextOpenDialog(firstRun, [workspacePath]);
    await openFolder.click();
    await expect(
      sidebar.getByRole("button", { name: basename(workspacePath), exact: true }),
    ).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "新しい会話", exact: true })).toBeEnabled();
    await createNamedThread(window, "Alpha");

    const row = sidebar.locator(".session-row", { hasText: "Alpha" });
    await row.click({ button: "right" });
    await row.getByRole("menu").getByRole("button", { name: "会話をピン留め" }).click();
    const pinned = sidebar.getByRole("region", { name: "ピン留めした会話" });
    const pinnedRow = pinned.locator(".session-row", { hasText: "Alpha" });
    await expect(pinnedRow).toBeVisible();
    const unpin = pinnedRow.getByRole("button", { name: /「Alpha」のピン留めを解除$/ });
    await pinnedRow.hover();
    await expect(unpin).toHaveAttribute("aria-pressed", "true");
    await unpin.click();
    await expect(pinned).toHaveCount(0);
    await expect(row).toHaveAttribute("data-session-pinned", "false");

    await sidebar.getByRole("button", { name: "スキル", exact: true }).click();
    await expect(
      skills.getByText(`「${basename(workspacePath)}」で使う`, { exact: false }),
    ).toBeVisible();
    await skills.getByRole("searchbox", { name: "スキルを検索" }).fill("unmatched-resource");
    await expect(skills.getByText("該当するスキルがありません")).toBeVisible();
    await skills.getByRole("tab", { name: /^拡張機能/ }).click();
    await extensions.getByRole("searchbox", { name: "拡張機能を検索" }).fill("unmatched-resource");
    await expect(extensions.getByText("該当する拡張機能がありません")).toBeVisible();
    await extensions.getByRole("button", { name: "アプリに戻る" }).click();
  } finally {
    await firstRun.close();
  }

  const secondRun = await launch();
  try {
    const window = await secondRun.firstWindow();
    const sidebar = window.locator("#primary-sidebar");
    await expect(window.locator("html")).toHaveAttribute("lang", "ja");
    await sidebar.getByRole("button", { name: "設定", exact: true }).click();
    const settings = window.getByTestId("settings-surface");
    await settings.getByRole("button", { name: "外観" }).click();
    await languagePicker(window).selectOption("en");
    await settings.getByRole("button", { name: "Back to app" }).click();
    await expect(sidebar.getByRole("button", { name: "Settings", exact: true })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "New thread", exact: true })).toBeVisible();
  } finally {
    await secondRun.close();
  }
});

test("Japanese text-only primary actions share the centered label style", async ({}, testInfo) => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("button-label-alignment");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    scrubProviderEnv: true,
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    await setDesktopTestLocale(window, "ja");
    await window
      .locator("#primary-sidebar")
      .getByRole("button", { name: "会話", exact: true })
      .click();
    const newConversation = window.locator(".empty-panel__actions").getByRole("button", {
      name: "新しい会話",
    });
    await expect(newConversation.locator(".button__label")).toHaveCSS("text-align", "center");
    await newConversation.screenshot({ path: testInfo.outputPath("new-conversation-button.png") });

    await window.getByTestId("sidebar-scheduled").click();
    const createSchedule = window.getByTestId("scheduled-task-create");
    await expect(createSchedule.locator(".button__label")).toHaveText("作成");
    await expect(createSchedule.locator(".button__label")).toHaveCSS("text-align", "center");
    await createSchedule.screenshot({ path: testInfo.outputPath("schedule-create-button.png") });
  } finally {
    await harness.close();
  }
});

test("a language picked in one window applies to the other open windows", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("settings-language-windows");
  const harness = await launchDesktop(userDataDir, { initialWorkspaces: [workspacePath] });
  try {
    const first = await harness.firstWindow();
    const second = await openSecondWindow(harness);
    await openAppearance(first);
    await languagePicker(first).selectOption("zh-CN");
    await expect(first.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(second.locator("html")).toHaveAttribute("lang", "zh-CN");
    const secondSurface = await openAppearance(second);
    await expect(languagePicker(second)).toHaveValue("zh-CN");
    await expect(secondSurface).toContainText(chinese("settings.appearance.transparency.title"));
  } finally {
    await harness.close();
  }
});
