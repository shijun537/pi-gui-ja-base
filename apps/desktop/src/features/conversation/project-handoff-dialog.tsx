import { useEffect, useId, useRef, useState } from "react";
import type {
  DesktopAppState,
  WorkspaceRecord,
  WorkspaceSessionTarget,
} from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { useTranslation } from "../../i18n";
import { trapDialogFocus } from "../../ui/dialog-focus";

interface ProjectHandoffDialogProps {
  readonly projects: readonly WorkspaceRecord[];
  readonly onClose: () => void;
  readonly onPickFolder: () => Promise<string | undefined>;
  readonly onPrepare: () => Promise<string | null>;
  readonly onSubmit: (projectId: string, draft: string) => Promise<void>;
}

function ProjectHandoffDialog({
  projects,
  onClose,
  onPickFolder,
  onPrepare,
  onSubmit,
}: ProjectHandoffDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"folder" | "prepare" | "submit" | null>(null);
  const [error, setError] = useState(false);
  const canClose = busy !== "folder" && busy !== "submit";

  useEffect(() => dialogRef.current?.focus(), []);

  const pickFolder = async () => {
    setBusy("folder");
    setError(false);
    try {
      const selected = await onPickFolder();
      if (selected) setProjectId(selected);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };
  const prepare = async () => {
    setBusy("prepare");
    setError(false);
    try {
      const result = await onPrepare();
      if (result) setDraft(result);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };
  const submit = async () => {
    setBusy("submit");
    setError(false);
    try {
      await onSubmit(projectId, draft.trim());
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tree-modal-backdrop">
      <div
        className="tree-modal tree-modal--compact"
        aria-labelledby={titleId}
        aria-modal="true"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Tab") trapDialogFocus(event, dialogRef.current);
          if (event.key === "Escape" && canClose) onClose();
        }}
      >
        <div className="tree-modal__header">
          <h2 className="tree-modal__title" id={titleId}>
            {t("handoff.title")}
          </h2>
        </div>
        <form
          className="tree-modal__summary-step project-handoff"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && projectId && draft.trim()) submit().catch(() => setError(true));
          }}
        >
          <p className="tree-modal__summary-copy">{t("handoff.help")}</p>
          <label>
            {t("handoff.project")}
            <select
              value={projectId}
              disabled={busy !== null}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">{t("handoff.chooseProject")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="button"
            disabled={busy !== null}
            onClick={() => {
              pickFolder().catch(() => setError(true));
            }}
          >
            {t("handoff.openFolder")}
          </button>
          <label>
            {t("handoff.draft")}
            <textarea
              rows={7}
              value={draft}
              disabled={busy !== null}
              onChange={(event) => setDraft(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={busy !== null || !projectId || Boolean(draft.trim())}
            onClick={() => {
              prepare().catch(() => setError(true));
            }}
          >
            {t(busy === "prepare" ? "handoff.preparing" : "handoff.prepare")}
          </button>
          {error ? <p role="status">{t("handoff.error")}</p> : null}
          <div className="tree-modal__actions">
            <button
              type="button"
              className="button button--secondary"
              disabled={!canClose}
              onClick={onClose}
            >
              {t("settings.common.cancel")}
            </button>
            <button
              type="submit"
              className="button button--primary"
              disabled={busy !== null || !projectId || !draft.trim()}
            >
              <span className="button__label">{t("handoff.submit")}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ProjectHandoff({
  api,
  origin,
  projects,
  onClose,
  update,
  flushDraft,
}: {
  readonly api: PiDesktopApi;
  readonly origin: WorkspaceSessionTarget;
  readonly projects: readonly WorkspaceRecord[];
  readonly onClose: () => void;
  readonly update: (request: () => Promise<DesktopAppState>) => Promise<DesktopAppState>;
  readonly flushDraft: (origin: WorkspaceSessionTarget) => Promise<void>;
}) {
  return (
    <ProjectHandoffDialog
      projects={projects}
      onClose={onClose}
      onPrepare={() => api.prepareProjectHandoff()}
      onPickFolder={async () => {
        await flushDraft(origin);
        const state = await update(() => api.pickWorkspace());
        if (state.selectedWorkspaceId === origin.workspaceId) return undefined;
        const project = state.workspaces.find(
          (workspace) => workspace.id === state.selectedWorkspaceId && workspace.kind === "primary",
        );
        await update(() => api.selectSession(origin));
        if (!project) throw new Error("The project could not be opened.");
        return project.id;
      }}
      onSubmit={async (projectId, draft) => {
        if (!projects.some((project) => project.id === projectId)) {
          throw new Error("The project is unavailable.");
        }
        await flushDraft(origin);
        const state = await update(() =>
          api.startThread({ rootWorkspaceId: projectId, environment: "local", prompt: draft }),
        );
        if (
          state.selectedWorkspaceId !== projectId ||
          state.activeView !== "threads" ||
          !state.selectedSessionId
        ) {
          throw new Error("The project thread could not be started.");
        }
        onClose();
      }}
    />
  );
}
