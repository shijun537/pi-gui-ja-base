import { expect, test } from "@playwright/test";
import {
  createNamedThread,
  launchDesktop,
  selectSidePanel,
  makeUserDataDir,
  makeWorkspace,
  setDesktopTestLocale,
} from "../helpers/electron-app";

test("Review and Terminal share one side workspace while the composer stays available", async () => {
  const userDataDir = await makeUserDataDir();
  const workspacePath = await makeWorkspace("terminal-diff-layout");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspacePath],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await setDesktopTestLocale(window, "en");
    await createNamedThread(window, "Terminal and Review layout");
    await selectSidePanel(window, "Review");
    const changes = window.locator(".diff-panel");
    await expect(changes).toBeVisible();
    const changesBox = await changes.boundingBox();

    await selectSidePanel(window, "Terminal");
    const terminal = window.getByTestId("integrated-terminal");
    await expect(terminal).toBeVisible();
    await expect(changes).toHaveCount(0);
    await expect(window.getByTestId("composer")).toBeVisible();
    const terminalBox = await terminal.boundingBox();
    const composerBox = await window.getByTestId("composer").boundingBox();
    if (!changesBox || !terminalBox || !composerBox) {
      throw new Error("Expected visible tool and composer bounds");
    }
    expect(Math.abs(terminalBox.x - changesBox.x)).toBeLessThan(3);
    expect(terminalBox.width).toBeGreaterThanOrEqual(300);
    expect(composerBox.x + composerBox.width).toBeLessThanOrEqual(terminalBox.x + 1);

    await window.getByRole("tab", { name: "Review", exact: true }).click();
    await expect(changes).toBeVisible();
    await expect(terminal).toHaveCount(0);
    await expect(window.getByRole("tab", { name: "Terminal", exact: true })).toHaveCount(1);
    await expect(window.getByTestId("composer")).toBeVisible();

    await window.getByRole("tab", { name: "Terminal", exact: true }).click();
    await expect(terminal.getByRole("button", { name: "New terminal" })).toBeEnabled();
    await setDesktopTestLocale(window, "ja");
    const tabs = terminal.getByRole("tablist", { name: "ターミナルのセッション" });
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await terminal.getByRole("button", { name: "ターミナルを追加" }).click();
    await expect(tabs.getByRole("tab")).toHaveCount(2);
    await terminal.getByRole("button", { name: "ターミナルを再起動" }).click();
    const shellInput = terminal.locator(".xterm-helper-textarea");
    await shellInput.focus();
    await shellInput.pressSequentially("echo PI_TERMINAL_READY");
    await shellInput.press("Enter");
    await expect(
      terminal.locator(".xterm-rows > div").filter({ hasText: /^PI_TERMINAL_READY\s*$/ }),
    ).toBeVisible();
    await tabs
      .getByRole("button", { name: /^「.+」を閉じる$/ })
      .last()
      .click();
    await expect(tabs.getByRole("tab")).toHaveCount(1);
  } finally {
    await harness.close();
  }
});
