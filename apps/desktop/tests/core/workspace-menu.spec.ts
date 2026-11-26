import { basename } from "node:path";
import { expect, test } from "@playwright/test";
import {
  assertExists,
  getDesktopState,
  launchDesktop,
  makeUserDataDir,
  makeWorkspace,
  setDesktopTestLocale,
  waitForWorkspaceByPath,
} from "../helpers/electron-app";

test("supports workspace rename and remove from the sidebar menu", async () => {
  test.setTimeout(60_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("workspace-menu-a");
  const workspaceB = await makeWorkspace("workspace-menu-b");
  const harness = await launchDesktop(userDataDir, {
    initialWorkspaces: [workspaceA, workspaceB],
    testMode: "background",
  });

  try {
    const window = await harness.firstWindow();
    await waitForWorkspaceByPath(window, workspaceA);
    await waitForWorkspaceByPath(window, workspaceB);

    const state = await getDesktopState(window);
    const workspace = state.workspaces.find((entry) => entry.path === workspaceA);
    assertExists(workspace, "Expected first workspace");

    await window
      .getByRole("button", { name: `Workspace actions for ${basename(workspaceA)}` })
      .click();
    const workspaceMenu = window.locator(".workspace-menu").last();
    await expect(workspaceMenu.getByRole("button", { name: "Open folder" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Edit name" })).toBeVisible();
    await expect(workspaceMenu.getByRole("button", { name: "Remove" })).toBeVisible();

    await workspaceMenu.getByRole("button", { name: "Edit name" }).click();
    const renameInput = window.getByLabel(`Rename ${basename(workspaceA)}`);
    await renameInput.fill("Renamed workspace");
    await window.getByRole("button", { name: "Save" }).click();

    await expect
      .poll(async () => {
        const latest = await getDesktopState(window);
        return latest.workspaces.find((entry) => entry.id === workspace.id)?.name;
      })
      .toBe("Renamed workspace");

    const acceptRemoval = window.waitForEvent("dialog").then((dialog) => dialog.accept());
    await window.getByRole("button", { name: "Workspace actions for Renamed workspace" }).click();
    await Promise.all([window.getByRole("button", { name: "Remove" }).click(), acceptRemoval]);

    await expect
      .poll(async () => {
        const latest = await getDesktopState(window);
        return latest.workspaces.some((entry) => entry.id === workspace.id);
      })
      .toBe(false);
  } finally {
    await harness.close();
  }
});

test("project folders retain independent sidebar colors after restart", async () => {
  test.setTimeout(90_000);
  const userDataDir = await makeUserDataDir();
  const workspaceA = await makeWorkspace("folder-color-a");
  const workspaceB = await makeWorkspace("folder-color-b");
  const launch = () =>
    launchDesktop(userDataDir, {
      initialWorkspaces: [workspaceA, workspaceB],
      testMode: "background",
    });
  let harness = await launch();
  try {
    let window = await harness.firstWindow();
    await setDesktopTestLocale(window, "ja");
    const icon = (workspace: string) =>
      window
        .locator(".workspace-row")
        .filter({
          has: window.getByRole("button", { name: `${basename(workspace)} の操作` }),
        })
        .locator(".workspace-row__icon");
    const changeColor = async (workspace: string, label: string) => {
      const menu = window.getByRole("button", { name: `${basename(workspace)} の操作` });
      await menu.click();
      const color = window
        .getByRole("group", { name: "フォルダの色" })
        .getByRole("button", { name: label, exact: true });
      await color.click();
      await expect(color).toHaveAttribute("aria-pressed", "true");
      await window.keyboard.press("Escape");
    };
    await changeColor(workspaceA, "青");
    await expect(icon(workspaceA)).toHaveAttribute("data-folder-color", "blue");
    await expect(icon(workspaceB)).not.toHaveAttribute("data-folder-color");
    await changeColor(workspaceB, "緑");
    await harness.close();
    harness = await launch();
    window = await harness.firstWindow();
    await expect(icon(workspaceA)).toHaveAttribute("data-folder-color", "blue");
    await expect(icon(workspaceB)).toHaveAttribute("data-folder-color", "green");
    await changeColor(workspaceA, "既定色");
    await expect(icon(workspaceA)).not.toHaveAttribute("data-folder-color");
    await expect(icon(workspaceB)).toHaveAttribute("data-folder-color", "green");
  } finally {
    await harness.close();
  }
});
