import type { WorkspaceRecord } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import type { SettingsSection } from "../settings/settings-view";
import type { useNewThreadController } from "./hooks/use-new-thread-controller";
import { NewThreadView } from "./new-thread-view";

export function NewConversationSurface({
  newThread,
  workspaces: newConversationWorkspaces,
  folderless: newChat,
  permissionControl,
  openSettings,
}: {
  readonly newThread: ReturnType<typeof useNewThreadController>;
  readonly workspaces: readonly WorkspaceRecord[];
  readonly folderless: boolean;
  readonly permissionControl?: import("react").ReactNode;
  readonly openSettings: (workspaceId?: string, section?: SettingsSection) => void;
}) {
  const { t } = useTranslation();
  return newConversationWorkspaces.length > 0 ? (
    <NewThreadView
      workspaces={newConversationWorkspaces}
      selectedWorkspaceId={newThread.rootWorkspaceId || newConversationWorkspaces[0]?.id || ""}
      folderless={newChat}
      permissionControl={permissionControl}
      runtime={newThread.runtime}
      environment={newThread.environment}
      prompt={newThread.prompt}
      attachments={newThread.attachments}
      lastError={newThread.composerError}
      provider={newThread.resolvedProvider}
      modelId={newThread.resolvedModelId}
      thinkingLevel={newThread.resolvedThinkingLevel}
      modelOnboarding={newThread.modelOnboarding}
      composerRef={newThread.composerRef}
      activeSlashCommand={newThread.slashMenu.activeSlashFlow?.command}
      activeSlashCommandMeta={newThread.slashMenu.activeSlashFlow?.command?.description}
      slashSections={newThread.slashMenu.slashSections}
      slashOptions={newThread.slashMenu.slashOptions}
      selectedSlashCommand={
        newThread.slashMenu.activeSlashOptionCommand ?? newThread.slashMenu.selectedSlashCommand
      }
      selectedSlashOption={newThread.slashMenu.selectedSlashOption}
      showSlashMenu={newThread.slashMenu.showSlashMenu}
      showSlashOptionMenu={newThread.slashMenu.showSlashOptionMenu}
      slashOptionEmptyState={newThread.slashMenu.slashOptionEmptyState}
      showMentionMenu={newThread.mentionMenu.showMentionMenu}
      mentionOptions={newThread.mentionMenu.mentionOptions}
      selectedMentionIndex={newThread.mentionMenu.selectedIndex}
      onChangePrompt={newThread.setPrompt}
      onSelectEnvironment={newThread.setEnvironment}
      onSelectWorkspace={newThread.selectWorkspace}
      onSetModel={(provider, modelId) => {
        newThread.setProvider(provider);
        newThread.setModelId(modelId);
      }}
      onSetThinking={newThread.setThinkingLevel}
      extensionFlags={newThread.extensionFlags}
      onSetExtensionFlag={newThread.setExtensionFlag}
      onOpenModelSettings={(section) => openSettings(newThread.workspace?.id, section)}
      onComposerKeyDown={newThread.handleComposerKeyDown}
      onComposerPaste={newThread.handleComposerPaste}
      onComposerDrop={newThread.handleComposerDrop}
      onClearSlashCommand={newThread.slashMenu.resetSlashUi}
      onSelectSlashCommand={(command) => {
        newThread.slashMenu.applySlashCommandSelection(command, "click");
      }}
      onSelectSlashOption={(option) => {
        newThread.slashMenu.applySlashOptionSelection(option);
      }}
      onSelectMention={newThread.mentionMenu.insertMention}
      onEnableMentionExtension={newThread.mentionMenu.enableMentionExtension}
      onAddAttachments={newThread.addAttachments}
      onRemoveAttachment={newThread.removeAttachment}
      onSubmit={newThread.startThread}
    />
  ) : (
    <section className="canvas canvas--empty">
      <div className="empty-panel">
        <div className="session-header__eyebrow">{t("workspace.start.label")}</div>
        <h1>{t("workspace.start.title")}</h1>
        <p>{t("workspace.start.scheduled")}</p>
      </div>
    </section>
  );
}
