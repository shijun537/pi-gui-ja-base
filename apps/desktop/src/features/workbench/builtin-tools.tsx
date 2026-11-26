import type { ComponentType, ReactNode } from "react";
import { BUILTIN_TOOL_KINDS, type BuiltinToolKind } from "../../../contracts/workbench";
import type { MessageKey } from "../../i18n";
import { DiffIcon, FileIcon, TerminalIcon } from "../../ui/icons";

interface BuiltinToolDefinition {
  readonly labelKey: MessageKey;
  /** Shown in the tool chooser. */
  readonly descriptionKey: MessageKey;
  readonly toggleKey: MessageKey;
  readonly Icon: ComponentType;
  /** Key that toggles the tool with the platform modifier, when it has one. */
  readonly shortcutKey?: string;
}

/** Presentation for every built-in tool; a missing kind fails the build. */
export const BUILTIN_TOOLS = {
  files: {
    labelKey: "workbench.tool.files",
    descriptionKey: "workbench.tool.filesDescription",
    toggleKey: "workbench.toggleFiles",
    Icon: FileIcon,
  },
  changes: {
    labelKey: "workbench.tool.changes",
    descriptionKey: "workbench.tool.changesDescription",
    toggleKey: "settings.shortcuts.toggleReview",
    Icon: DiffIcon,
    shortcutKey: "R",
  },
  terminal: {
    labelKey: "workbench.tool.terminal",
    descriptionKey: "workbench.tool.terminalDescription",
    toggleKey: "settings.shortcuts.toggleTerminal",
    Icon: TerminalIcon,
    shortcutKey: "J",
  },
} as const satisfies Record<BuiltinToolKind, BuiltinToolDefinition>;

/** Chooser order follows the contract's kind list. */
export const BUILTIN_TOOL_ENTRIES = BUILTIN_TOOL_KINDS.map(
  (kind): BuiltinToolDefinition & { readonly kind: BuiltinToolKind } => ({
    kind,
    ...BUILTIN_TOOLS[kind],
  }),
);

/** The composition root supplies one panel per built-in tool; rendered only while selected. */
type BuiltinToolPanels = Record<BuiltinToolKind, () => ReactNode>;

/** Requires a panel for every built-in kind, so a new tool cannot silently render nothing. */
export function renderBuiltinToolPanel(
  kind: BuiltinToolKind,
  panels: BuiltinToolPanels,
): ReactNode {
  return panels[kind]();
}
