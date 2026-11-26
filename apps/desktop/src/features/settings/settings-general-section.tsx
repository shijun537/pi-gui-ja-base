import { useEffect, useState } from "react";
import type { RuntimeSnapshot } from "@pi-gui/session-driver/runtime-types";
import type { ModelSettingsScopeMode } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import {
  readVoiceLanguage,
  voiceLanguageStorageKey,
  writeVoiceLanguage,
} from "../../lib/voice-language";
import { SettingsSelect, SettingsSwitch } from "./settings-controls";
import { SettingsGroup, SettingsRow } from "./settings-utils";

interface SettingsGeneralSectionProps {
  readonly runtime?: RuntimeSnapshot;
  readonly modelSettingsScopeMode: ModelSettingsScopeMode;
  readonly integratedTerminalShell: string;
  readonly onSetModelSettingsScopeMode: (mode: ModelSettingsScopeMode) => void;
  readonly onSetIntegratedTerminalShell: (shellPath: string) => void;
  readonly onToggleSkillCommands: (enabled: boolean) => void;
}

export function SettingsGeneralSection({
  runtime,
  modelSettingsScopeMode,
  integratedTerminalShell,
  onSetModelSettingsScopeMode,
  onSetIntegratedTerminalShell,
  onToggleSkillCommands,
}: SettingsGeneralSectionProps) {
  const { t } = useTranslation();
  const [voiceLanguage, setVoiceLanguage] = useState(readVoiceLanguage);
  const [terminalShellDraft, setTerminalShellDraft] = useState(integratedTerminalShell);

  useEffect(() => {
    setTerminalShellDraft(integratedTerminalShell);
  }, [integratedTerminalShell]);

  useEffect(() => {
    const syncVoiceLanguage = (event: StorageEvent) => {
      if (event.key === voiceLanguageStorageKey || event.key === null) {
        setVoiceLanguage(readVoiceLanguage());
      }
    };
    window.addEventListener("storage", syncVoiceLanguage);
    return () => window.removeEventListener("storage", syncVoiceLanguage);
  }, []);

  const commitTerminalShellDraft = () => {
    if (terminalShellDraft !== integratedTerminalShell) {
      onSetIntegratedTerminalShell(terminalShellDraft);
    }
  };

  return (
    <>
      <SettingsGroup title={t("settings.general.groupAgent")}>
        <SettingsRow
          title={t("settings.general.modelScope.title")}
          description={t("settings.general.modelScope.description")}
        >
          <SettingsSelect
            label={t("settings.general.modelScope.label")}
            options={[
              { value: "app-global", label: t("settings.general.modelScope.appGlobal") },
              { value: "per-repo", label: t("settings.general.modelScope.perRepo") },
            ]}
            value={modelSettingsScopeMode}
            onChange={onSetModelSettingsScopeMode}
          />
        </SettingsRow>
        <SettingsRow
          title={t("settings.general.skillCommands.title")}
          description={t("settings.general.skillCommands.description")}
        >
          <SettingsSwitch
            checked={runtime?.settings.enableSkillCommands ?? true}
            label={t("settings.general.skillCommands.label")}
            onChange={onToggleSkillCommands}
          />
        </SettingsRow>
      </SettingsGroup>

      {window.piApp?.platform === "win32" ? (
        <SettingsGroup title={t("settings.general.groupVoice")}>
          <SettingsRow
            title={t("settings.general.voiceLanguage.title")}
            description={t("settings.general.voiceLanguage.description")}
          >
            <SettingsSelect
              label={t("settings.general.voiceLanguage.title")}
              options={[
                { value: "auto", label: t("settings.general.voiceLanguage.auto") },
                { value: "ja", label: t("settings.general.voiceLanguage.japanese") },
              ]}
              value={voiceLanguage}
              onChange={(language) => {
                writeVoiceLanguage(language);
                setVoiceLanguage(language);
              }}
            />
          </SettingsRow>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title={t("settings.general.groupTerminal")}>
        <SettingsRow
          title={t("settings.general.shell.title")}
          description={t("settings.general.shell.description")}
        >
          <input
            aria-label={t("settings.general.shell.label")}
            className="settings-text-input"
            placeholder="/bin/zsh"
            spellCheck={false}
            type="text"
            value={terminalShellDraft}
            onBlur={commitTerminalShellDraft}
            onChange={(event) => setTerminalShellDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
