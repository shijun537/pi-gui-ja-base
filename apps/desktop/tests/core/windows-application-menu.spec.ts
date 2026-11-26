import { expect, test } from "@playwright/test";
import {
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  setDesktopTestLocale,
} from "../helpers/electron-app";

test("Windows menu shows localized help and opens the Skills view", async () => {
  test.skip(process.platform !== "win32", "Uses the native Windows menu");
  const userDataDir = await makeUserDataDir();
  const workspace = await makeWorkspace("windows-menu");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspace],
    testMode: "background",
  });
  try {
    const window = await harness.firstWindow();
    const readMenu = () =>
      harness.electronApp.evaluate(({ app, BrowserWindow, Menu }) => ({
        visible: BrowserWindow.getAllWindows()[0]?.isMenuBarVisible(),
        version: app.getVersion(),
        labels: Menu.getApplicationMenu()?.items.map((item) => item.label),
        help: Menu.getApplicationMenu()
          ?.items[3]?.submenu?.items.map((item) => item.label)
          .filter(Boolean),
      }));
    await setDesktopTestLocale(window, "ja");
    const { version } = await readMenu();
    await expect.poll(readMenu).toEqual({
      visible: true,
      version,
      labels: ["ファイル(&F)", "編集(&E)", "表示(&V)", "ヘルプ(&H)"],
      help: ["Pi の使い方", "Pi-GUI の機能", "利用可能なスキル", `バージョン ${version}`],
    });
    await harness.electronApp.evaluate(({ Menu, BrowserWindow }) => {
      const menu = Menu.getApplicationMenu()?.items[3]?.submenu;
      const skills = menu?.getMenuItemById("windows-skills");
      if (!skills) throw new Error("No Skills menu item");
      Reflect.apply(skills.click, skills, [undefined, BrowserWindow.getAllWindows()[0], undefined]);
    });
    await expect(window.getByRole("tab", { name: /^スキル/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await setDesktopTestLocale(window, "en");
    await expect
      .poll(async () => (await readMenu()).labels)
      .toEqual(["&File", "&Edit", "&View", "&Help"]);
    await window.getByRole("button", { name: "Back to app", exact: true }).click();
    await window.keyboard.press("Control+n");
    await expect(window.getByTestId("new-thread-composer")).toBeVisible();
  } finally {
    await harness.close();
  }
});
