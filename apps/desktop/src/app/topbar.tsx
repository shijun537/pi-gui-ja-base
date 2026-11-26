import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import type { AppView, WorkspaceRecord, WorktreeRecord } from "../../contracts/desktop-state";
import { getSidePanelToggleShortcutLabel, type PiDesktopApi } from "../../contracts/ipc";
import { useTranslation } from "../i18n";
import { SidePanelIcon } from "../ui/icons";

interface TopbarProps {
  readonly activeView: AppView;
  readonly sessionTitle?: string;
  readonly children?: ReactNode;
  readonly rootWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorkspace: WorkspaceRecord | undefined;
  readonly selectedWorktree: WorktreeRecord | undefined;
  readonly api: PiDesktopApi;
  readonly panelAvailable: boolean;
  readonly panelVisible: boolean;
  /** Rendered in the actions cluster, next to the side-panel toggle. */
  readonly editorControl?: ReactNode;
  readonly onTogglePanel: () => void;
}

export function Topbar({
  activeView,
  sessionTitle,
  children,
  rootWorkspace,
  selectedWorkspace,
  selectedWorktree,
  api,
  panelAvailable,
  panelVisible,
  editorControl,
  onTogglePanel,
}: TopbarProps) {
  const { t } = useTranslation();
  const handleDoubleClick = (event: ReactMouseEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.closest(".topbar__actions")) return;
    void api.toggleWindowMaximize().catch((error: unknown) => {
      console.error("[renderer] toggleWindowMaximize failed", error);
    });
  };
  const checkoutLabel =
    selectedWorkspace?.kind === "worktree"
      ? (selectedWorktree?.name ?? selectedWorkspace.branchName ?? selectedWorkspace.name)
      : selectedWorkspace?.branchName;

  return (
    <header className="topbar" data-testid="topbar" onDoubleClick={handleDoubleClick}>
      <div className="topbar__title">
        <span
          className={
            rootWorkspace ? "topbar__workspace" : "topbar__workspace topbar__workspace--empty"
          }
          title={checkoutLabel ? `${rootWorkspace?.name ?? ""} · ${checkoutLabel}` : undefined}
        >
          {rootWorkspace?.kind === "chat"
            ? t("sidebar.newChat")
            : (rootWorkspace?.name ?? t("workspace.start.title"))}
        </span>
        {sessionTitle ? (
          <>
            <span className="topbar__separator">/</span>
            <h1 className="chat-header__title" title={sessionTitle}>
              {sessionTitle}
            </h1>
          </>
        ) : activeView === "threads" && checkoutLabel ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{checkoutLabel}</span>
          </>
        ) : (activeView === "new-thread" || activeView === "new-chat") && rootWorkspace ? (
          <>
            <span className="topbar__separator">/</span>
            <span className="topbar__session">{t("sidebar.newThread")}</span>
          </>
        ) : null}
      </div>
      <div className="topbar__actions">
        {children}
        {editorControl}
        {!panelVisible && selectedWorkspace?.kind !== "chat" ? (
          <div className="shortcut-tooltip-wrap topbar__tooltip-wrap">
            <button
              type="button"
              aria-label={t("settings.shortcuts.toggleSidePanel")}
              aria-pressed={panelVisible}
              aria-controls="task-workbench"
              data-testid="toggle-side-panel"
              className={`icon-button topbar__icon${panelVisible ? " icon-button--active" : ""}`}
              disabled={!panelAvailable}
              onClick={onTogglePanel}
            >
              <SidePanelIcon />
            </button>
            <span className="shortcut-tooltip topbar__tooltip" role="tooltip">
              <span>{t("workspace.start.showSidePanel")}</span>
              <kbd>{getSidePanelToggleShortcutLabel(api.platform)}</kbd>
            </span>
          </div>
        ) : null}
      </div>
    </header>
  );
}
