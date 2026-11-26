import { lstat, realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { SettingsManager, type InlineExtension } from "@earendil-works/pi-coding-agent";
import type { ProjectApprovalMode, WorkspaceRef } from "@pi-gui/session-driver";
import type { PiResourceLoaderOptions } from "./npm-package-fallback.js";

export type ProjectApprovalPolicy = (
  workspace: WorkspaceRef,
) => Promise<ProjectApprovalMode | undefined>;

export const projectApprovalResources = {
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
} satisfies PiResourceLoaderOptions;

/** Pi resolves configured packages before applying the resource filters. */
export function projectApprovalSettings(settings: SettingsManager): SettingsManager {
  return SettingsManager.fromStorage({
    withLock: (scope, read) => {
      const source =
        scope === "global" ? settings.getGlobalSettings() : settings.getProjectSettings();
      // The approved command is shown as submitted. Project shell overrides can add commands.
      const { shellPath: _shellPath, shellCommandPrefix: _shellCommandPrefix, ...values } = source;
      read(JSON.stringify({ ...values, packages: [] }));
    },
  });
}

const approvalExtension = "pi-gui-project-tool-approval";
const readTools = ["read", "grep", "find", "ls"];
const editTools = ["edit", "write"];
const commandTools = ["bash", "powershell"];
// Pi 1.4's file tools normalize these spaces before opening a file.
const piNormalizedSpaces = /[\u00a0\u2000-\u200a\u202f\u205f\u3000]/;
const blocked = {
  block: true,
  reason: "This operation is disabled by the project's tool policy.",
} as const;

async function projectPath(
  cwd: string,
  requested: string,
  allowNew: boolean,
): Promise<{ absolute: string; toolPath: string } | undefined> {
  const root = await realpath(cwd);
  const target = resolve(root, requested);
  const inside = (path: string) => {
    const name = relative(root, path);
    return name !== ".." && !name.startsWith(`..${sep}`) && !isAbsolute(name);
  };
  if (!inside(target)) return;
  let existing = target;
  for (;;) {
    try {
      const canonical = await realpath(existing);
      const result = resolve(canonical, relative(existing, target));
      const withinProject = relative(root, result);
      if (!inside(result) || piNormalizedSpaces.test(withinProject)) return;
      if (
        process.platform === "win32" &&
        withinProject.split(sep).some((name) => /[:]|[ .]$/.test(name))
      )
        return;
      return { absolute: result, toolPath: withinProject ? `.${sep}${withinProject}` : "." };
    } catch (error) {
      if (!allowNew || (error as NodeJS.ErrnoException).code !== "ENOENT" || existing === root)
        return;
      try {
        await lstat(existing);
        return;
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") return;
      }
      existing = dirname(existing);
    }
  }
}

/** The restricted runtime may load only host-owned factories and no installed extensions. */
export function projectApprovalRuntime(mode: ProjectApprovalMode) {
  const approval: InlineExtension = {
    name: approvalExtension,
    hidden: true,
    factory(pi) {
      pi.on("tool_call", async (event, ctx) => {
        const read = readTools.includes(event.toolName);
        const command = commandTools.includes(event.toolName);
        if (!read && (mode === "read-only" || (!command && !editTools.includes(event.toolName))))
          return blocked;
        const input: Record<string, unknown> = event.input;
        try {
          const raw = command ? input.command : (input.path ?? ".");
          if (typeof raw !== "string" || !raw.trim()) return blocked;
          const file = command
            ? undefined
            : await projectPath(ctx.cwd, raw, event.toolName === "write");
          if (!command && !file) return blocked;
          if (file) input.path = file.toolPath;
          if (read) return;
          const signal = ctx.signal;
          if (!ctx.hasUI || !signal || signal.aborted) return blocked;
          const approved = await ctx.ui.confirm(
            command ? "Pi-GUI: run command" : "Pi-GUI: edit file",
            file?.absolute ?? raw,
            { signal },
          );
          if (!approved || signal.aborted)
            return { block: true, reason: "The operation was declined or cancelled." };
          if (
            file &&
            (await projectPath(ctx.cwd, file.absolute, event.toolName === "write"))?.absolute !==
              file.absolute
          )
            return blocked;
        } catch {
          return blocked;
        }
      });
    },
  };
  const resourceLoaderOptions: PiResourceLoaderOptions = {
    ...projectApprovalResources,
    extensionsOverride(result) {
      if (
        !result.extensions.some(
          (extension) =>
            extension.path === `<inline:${approvalExtension}>` &&
            extension.handlers.has("tool_call"),
        )
      ) {
        throw new Error("The project tool approval handler could not be loaded.");
      }
      return result;
    },
  };
  return {
    approval,
    resourceLoaderOptions,
    tools: mode === "read-only" ? [...readTools] : [...readTools, ...editTools, ...commandTools],
  };
}
