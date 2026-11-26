import { useRef, useState } from "react";
import type { DesktopAppState, ProjectApprovalMode } from "../../../contracts/desktop-state";
import type { PiDesktopApi } from "../../../contracts/ipc";
import { ChevronDownIcon, CheckIcon } from "../../ui/icons";
import { useTranslation } from "../../i18n";

type Mode = ProjectApprovalMode | "existing";
const modes = ["read-only", "confirm", "existing"] as const;

export function projectApprovalControl(
  api: PiDesktopApi,
  snapshot: DesktopAppState,
  workspaceId: string | undefined,
  save: (action: () => Promise<DesktopAppState>) => Promise<DesktopAppState>,
) {
  return workspaceId &&
    snapshot.workspaces.some(
      (workspace) => workspace.id === workspaceId && workspace.kind === "primary",
    ) ? (
    <ProjectApprovalPicker
      key={workspaceId}
      api={api}
      snapshot={snapshot}
      workspaceId={workspaceId}
      save={save}
    />
  ) : undefined;
}

function PermissionIcon({ mode }: { readonly mode: Mode }) {
  if (mode === "existing") return null;
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {mode === "read-only" ? (
        <path d="M12 22s7-3 7-9V5l-7-3-7 3v8c0 6 7 9 7 9z" />
      ) : (
        <path d="M7 12V6a1.5 1.5 0 0 1 3 0v4-6a1.5 1.5 0 0 1 3 0v6-5a1.5 1.5 0 0 1 3 0v6-3a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1c-2 0-4-1-5-3l-3-4a1.5 1.5 0 0 1 2-2l1 1" />
      )}
    </svg>
  );
}

export function ProjectApprovalPicker({
  api,
  workspaceId,
  snapshot,
  save,
}: {
  readonly api: PiDesktopApi;
  readonly workspaceId: string;
  readonly snapshot: DesktopAppState;
  readonly save: (action: () => Promise<DesktopAppState>) => Promise<DesktopAppState>;
}) {
  const { t } = useTranslation();
  const active = snapshot.activeProjectApprovalModes[workspaceId] ?? "existing";
  const requested = snapshot.projectApprovalModes[workspaceId] ?? "existing";
  const details = useRef<HTMLDetailsElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  async function select(mode: Mode) {
    setSaving(true);
    setError(false);
    try {
      await save(() => api.setProjectApprovalMode(workspaceId, mode === "existing" ? null : mode));
      if (details.current) {
        details.current.open = false;
        details.current.querySelector("summary")?.focus();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="project-approval">
      <details
        ref={details}
        className="project-approval__picker"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !details.current?.open) return;
          event.stopPropagation();
          details.current.open = false;
          details.current.querySelector("summary")?.focus();
        }}
      >
        <summary
          aria-label={t("composer.approval.label", { mode: t(`composer.approval.${active}`) })}
        >
          <PermissionIcon mode={active} />
          {t(`composer.approval.${active}`)}
          <ChevronDownIcon />
        </summary>
        <div className="project-approval__menu">
          {modes.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={mode === active}
              disabled={saving}
              onClick={() => {
                select(mode).catch(() => setError(true));
              }}
            >
              <span>
                <PermissionIcon mode={mode} />
              </span>
              <span>
                <strong>{t(`composer.approval.${mode}`)}</strong>
                <small>{t(`composer.approval.${mode}.detail`)}</small>
              </span>
              <span>{mode === active ? <CheckIcon /> : null}</span>
            </button>
          ))}
          {error ? <p role="alert">{t("composer.approval.saveError")}</p> : null}
        </div>
      </details>
      {requested !== active ? (
        <span className="project-approval__pending" role="status">
          {t("composer.approval.pending", { mode: t(`composer.approval.${requested}`) })}
        </span>
      ) : null}
    </div>
  );
}
