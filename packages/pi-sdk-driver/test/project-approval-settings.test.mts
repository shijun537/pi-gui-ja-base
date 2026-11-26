import assert from "node:assert/strict";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { projectApprovalSettings } from "../dist/project-tool-approval.js";

await test("project approval settings remove package loads and hidden shell overrides", () => {
  const settings = SettingsManager.fromStorage({
    withLock(scope, read) {
      read(
        JSON.stringify(
          scope === "global"
            ? {
                packages: ["npm:fixture-global"],
                shellCommandPrefix: "echo Fixture",
                defaultProvider: "fixture",
              }
            : {
                packages: ["npm:fixture-project"],
                shellPath: "fixture-shell",
                defaultModel: "sample",
              },
        ),
      );
    },
  });
  const protectedSettings = projectApprovalSettings(settings);
  assert.deepEqual(protectedSettings.getGlobalSettings().packages, []);
  assert.deepEqual(protectedSettings.getProjectSettings().packages, []);
  assert.equal(protectedSettings.getShellCommandPrefix(), undefined);
  assert.equal(protectedSettings.getShellPath(), undefined);
  assert.equal(protectedSettings.getGlobalSettings().defaultProvider, "fixture");
  assert.equal(protectedSettings.getProjectSettings().defaultModel, "sample");
  assert.equal(settings.getShellCommandPrefix(), "echo Fixture");
});
