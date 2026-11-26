import { useTranslation } from "../../i18n";
import {
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type { ComposerAttachment } from "../../../contracts/desktop-state";
import type { MentionOption } from "./hooks/use-mention-menu";
import type {
  ComposerSlashCommand,
  ComposerSlashCommandSection,
  ComposerSlashOption,
  ComposerSlashOptionEmptyState,
} from "./composer-commands";
import { describeComposerAttachmentError, hasFilesInDataTransfer } from "./composer-attachments";
import { ExtensionDock, type ExtensionDockModel } from "../extensions/extension-session-ui";
import {
  ExtensionIcon,
  FileIcon,
  ModelIcon,
  ReasoningIcon,
  SettingsIcon,
  SkillIcon,
  SparkIcon,
  StatusIcon,
} from "../../ui/icons";
import { ImageAttachmentThumb } from "./image-attachment-thumb";
import { QueuedComposerMessages } from "./queued-composer-messages";
import { ComposerVoiceInput } from "./composer-voice-input";

type ExtensionMentionOption = Extract<MentionOption, { kind: "extension" }>;
type FileMentionOption = Extract<MentionOption, { kind: "file" }>;

interface ComposerSurfaceProps {
  readonly lastError?: string;
  readonly activeSlashCommand?: ComposerSlashCommand;
  readonly activeSlashCommandMeta?: string;
  readonly topNotice?: ReactNode;
  readonly composerDraft: string;
  readonly setComposerDraft: (draft: string) => void;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly attachments: readonly ComposerAttachment[];
  readonly queuedMessages: readonly import("../../../contracts/desktop-state").QueuedComposerMessage[];
  readonly editingQueuedMessageId?: string;
  readonly slashSections: readonly ComposerSlashCommandSection[];
  readonly slashOptions: readonly ComposerSlashOption[];
  readonly selectedSlashCommand?: ComposerSlashCommand;
  readonly selectedSlashOption?: ComposerSlashOption;
  readonly showSlashMenu: boolean;
  readonly showSlashOptionMenu: boolean;
  readonly slashOptionEmptyState?: ComposerSlashOptionEmptyState;
  readonly onClearSlashCommand: () => void;
  readonly onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onComposerPaste: (event: ClipboardEvent<HTMLDivElement>) => void;
  readonly onComposerDrop: (event: DragEvent<HTMLDivElement>) => void;
  readonly onRemoveAttachment: (attachmentId: string) => void;
  readonly onEditQueuedMessage: (messageId: string) => void;
  readonly onCancelQueuedEdit: () => void;
  readonly onRemoveQueuedMessage: (messageId: string) => void;
  readonly onSteerQueuedMessage: (messageId: string) => void;
  readonly onSelectSlashCommand: (command: ComposerSlashCommand) => void;
  readonly onSelectSlashOption: (option: ComposerSlashOption) => void;
  readonly showMentionMenu: boolean;
  readonly mentionOptions: readonly MentionOption[];
  readonly selectedMentionIndex: number;
  readonly onSelectMention: (option: MentionOption) => void;
  readonly onEnableMentionExtension: (option: ExtensionMentionOption) => void;
  readonly textareaLabel: string;
  readonly textareaTestId: string;
  readonly textareaPlaceholder: string;
  readonly textareaClassName?: string;
  /** Cards extensions pinned above the composer, over the extension dock. */
  readonly pinnedCards?: ReactNode;
  readonly extensionDock?: ExtensionDockModel;
  readonly extensionDockExpanded?: boolean;
  readonly onToggleExtensionDock?: () => void;
  readonly onDismissExtensionDock?: () => void;
  readonly footer: (voiceControl?: ReactNode) => ReactNode;
  readonly voiceScope: string;
  readonly onSubmit: () => void;
  /** Transcript annotations waiting to go with the next message. */
  readonly annotationChip?: ReactNode;
}

export function ComposerSurface({
  lastError,
  activeSlashCommand,
  activeSlashCommandMeta,
  topNotice,
  composerDraft,
  setComposerDraft,
  composerRef,
  attachments,
  queuedMessages,
  editingQueuedMessageId,
  slashSections,
  slashOptions,
  selectedSlashCommand,
  selectedSlashOption,
  showSlashMenu,
  showSlashOptionMenu,
  slashOptionEmptyState,
  onClearSlashCommand,
  onComposerKeyDown,
  onComposerPaste,
  onComposerDrop,
  onRemoveAttachment,
  onEditQueuedMessage,
  onCancelQueuedEdit,
  onRemoveQueuedMessage,
  onSteerQueuedMessage,
  onSelectSlashCommand,
  onSelectSlashOption,
  showMentionMenu,
  mentionOptions,
  selectedMentionIndex,
  onSelectMention,
  onEnableMentionExtension,
  textareaLabel,
  textareaTestId,
  textareaPlaceholder,
  textareaClassName,
  pinnedCards,
  extensionDock,
  extensionDockExpanded = false,
  onToggleExtensionDock,
  onDismissExtensionDock,
  footer,
  voiceScope,
  onSubmit,
  annotationChip,
}: ComposerSurfaceProps) {
  const { t } = useTranslation();
  const [isDragActive, setIsDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const slashMenuOpen = showSlashMenu || (showSlashOptionMenu && Boolean(selectedSlashCommand));
  const voiceKey = JSON.stringify([voiceScope, editingQueuedMessageId]);
  const pendingVoiceSubmission = useRef<{ draft: string; key: string } | undefined>(undefined);

  useLayoutEffect(() => {
    const pending = pendingVoiceSubmission.current;
    pendingVoiceSubmission.current = undefined;
    // Submit through the current handler after the recognized text reaches the draft.
    if (pending?.key === voiceKey && pending.draft === composerDraft) onSubmit();
  });

  useLayoutEffect(() => {
    const menu = slashMenuRef.current;
    const editor = menu?.parentElement;
    if (!slashMenuOpen || !menu || !editor) return;
    const main = editor.closest(".main");
    const canvas = editor.closest(".canvas--new-thread") ?? main;
    const topbar = main?.querySelector(":scope > .topbar");
    const fit = () => {
      const bounds = editor.getBoundingClientRect();
      const region = canvas?.getBoundingClientRect();
      const top = Math.max(0, region?.top ?? 0, topbar?.getBoundingClientRect().bottom ?? 0);
      const bottom = Math.min(window.innerHeight, region?.bottom ?? window.innerHeight);
      const gap = 12;
      const above = bounds.top - top - gap * 2;
      const below = bottom - bounds.bottom - gap * 2;
      const placement = above < 96 && below > above ? "below" : "above";
      menu.dataset.placement = placement;
      menu.style.setProperty(
        "--slash-menu-available-height",
        `${Math.max(0, Math.floor(placement === "below" ? below : above))}px`,
      );
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(editor);
    if (canvas) observer.observe(canvas);
    if (topbar) observer.observe(topbar);
    canvas?.addEventListener("scroll", fit, { passive: true });
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      canvas?.removeEventListener("scroll", fit);
      window.removeEventListener("resize", fit);
    };
  }, [slashMenuOpen]);

  useLayoutEffect(() => {
    const list = slashMenuRef.current?.querySelector<HTMLElement>(".slash-menu");
    const active = list?.querySelector(".slash-menu__item--active, .slash-menu__option--active");
    if (!list || !active) return;
    const row = active.getBoundingClientRect();
    const menu = list.getBoundingClientRect();
    if (row.top < menu.top) list.scrollTop += row.top - menu.top;
    else if (row.bottom > menu.bottom) list.scrollTop += row.bottom - menu.bottom;
  }, [selectedSlashCommand, selectedSlashOption, showSlashMenu, showSlashOptionMenu]);

  const clearDragState = () => {
    dragDepthRef.current = 0;
    setIsDragActive(false);
  };

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!isDragActive) {
      return;
    }
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  };

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(event.dataTransfer)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    if (!isDragActive) {
      setIsDragActive(true);
    }
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    clearDragState();
    onComposerDrop(event);
  };

  return (
    <div
      className={`composer__surface ${isDragActive ? "composer__surface--drag-active" : ""}`}
      data-testid={`${textareaTestId}-surface`}
      onPaste={onComposerPaste}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {isDragActive ? (
        <div className="composer__drop-indicator" data-testid="composer-drop-indicator">
          {t("composer.drop")}
        </div>
      ) : null}
      {activeSlashCommand ? (
        <div className="composer__slash-intent">
          <span className="composer__slash-intent-icon" aria-hidden="true">
            <SlashCommandIcon command={activeSlashCommand} />
          </span>
          <span className="composer__slash-intent-body">
            <span className="composer__slash-intent-title">{activeSlashCommand.title}</span>
            {activeSlashCommandMeta ? (
              <span className="composer__slash-intent-meta">{activeSlashCommandMeta}</span>
            ) : null}
          </span>
          <button
            aria-label={t("composer.clearCommand", { name: activeSlashCommand.title })}
            className="composer__slash-intent-clear"
            type="button"
            onClick={onClearSlashCommand}
          >
            ×
          </button>
        </div>
      ) : null}
      <QueuedComposerMessages
        messages={queuedMessages}
        editingQueuedMessageId={editingQueuedMessageId}
        onEditMessage={onEditQueuedMessage}
        onCancelEdit={onCancelQueuedEdit}
        onRemoveMessage={onRemoveQueuedMessage}
        onSteerMessage={onSteerQueuedMessage}
      />
      {annotationChip}
      {attachments.length > 0 ? (
        <div className="composer__attachments">
          {attachments.map((attachment) => (
            <div
              className={`composer-attachment composer-attachment--${attachment.kind}`}
              key={attachment.id}
            >
              {attachment.kind === "image" ? (
                <ImageAttachmentThumb
                  className="composer-attachment__preview"
                  name={attachment.name}
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                />
              ) : (
                <>
                  <span className="composer-attachment__icon" aria-hidden="true">
                    <FileIcon />
                  </span>
                  <span className="composer-attachment__name">{attachment.name}</span>
                </>
              )}
              <button
                aria-label={t("composer.removeAttachment", { name: attachment.name })}
                className="composer-attachment__remove"
                type="button"
                onClick={() => onRemoveAttachment(attachment.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {pinnedCards}
      {extensionDock && onToggleExtensionDock ? (
        <ExtensionDock
          dock={extensionDock}
          expanded={extensionDockExpanded}
          onToggle={onToggleExtensionDock}
          onDismiss={onDismissExtensionDock}
        />
      ) : null}
      {lastError ? (
        <div
          className="composer__error error-banner"
          data-testid="composer-error-banner"
          role="alert"
          aria-label={t("conversation.error")}
        >
          {describeComposerAttachmentError(lastError, t)}
        </div>
      ) : null}
      <div className="composer__editor">
        {topNotice}
        {showMentionMenu ? (
          <div className="composer__menus">
            <div
              className="mention-menu"
              data-testid="mention-menu"
              onWheel={(event) => event.stopPropagation()}
            >
              <MentionMenuSections
                options={mentionOptions}
                selectedIndex={selectedMentionIndex}
                onSelect={onSelectMention}
                onEnableExtension={onEnableMentionExtension}
              />
            </div>
          </div>
        ) : null}
        {slashMenuOpen ? (
          <div className="composer__menus composer__menus--slash" ref={slashMenuRef}>
            {showSlashMenu ? (
              <div
                className="slash-menu"
                data-testid="slash-menu"
                onWheel={(event) => event.stopPropagation()}
              >
                {slashSections.map((section) => (
                  <div className="slash-menu__section" key={section.id}>
                    {section.title ? (
                      <div
                        className={`slash-menu__section-title slash-menu__section-title--${section.id}`}
                      >
                        <span className="slash-menu__section-icon" aria-hidden="true">
                          {section.id === "runtime" ? <SparkIcon /> : <SettingsIcon />}
                        </span>
                        <span>{section.title}</span>
                      </div>
                    ) : null}
                    {section.items.map((command) => (
                      <div className="slash-menu__entry" key={command.id}>
                        <button
                          className={`slash-menu__item ${command.section === "runtime" ? "slash-menu__item--skill" : ""} ${selectedSlashCommand?.id === command.id ? "slash-menu__item--active" : ""}`}
                          type="button"
                          onClick={() => onSelectSlashCommand(command)}
                        >
                          <span className="slash-menu__icon" aria-hidden="true">
                            <SlashCommandIcon command={command} />
                          </span>
                          {command.section === "runtime" ? (
                            <span className="slash-menu__content slash-menu__content--skill">
                              <span className="slash-menu__line">
                                <span className="slash-menu__title">{command.title}</span>
                                {command.sourceLabel ? (
                                  <span className="slash-menu__skill-badge">
                                    {command.sourceLabel}
                                  </span>
                                ) : null}
                                {command.compatibility?.status === "terminal-only" ? (
                                  <span className="slash-menu__skill-badge slash-menu__skill-badge--warning">
                                    {t("customize.extensions.terminalOnly")}
                                  </span>
                                ) : null}
                              </span>
                              <span className="slash-menu__description">{command.description}</span>
                              <span className="slash-menu__meta">
                                <span className="slash-menu__command slash-menu__command--skill">
                                  {command.command}
                                </span>
                              </span>
                            </span>
                          ) : (
                            <span className="slash-menu__content">
                              <span className="slash-menu__line">
                                <span className="slash-menu__title">{command.title}</span>
                                <span className="slash-menu__command">{command.command}</span>
                              </span>
                              <span className="slash-menu__description">{command.description}</span>
                            </span>
                          )}
                        </button>
                        {command.originalDescription ? (
                          <details className="slash-menu__original">
                            <summary>{t("composer.slash.original")}</summary>
                            <p>{command.originalDescription}</p>
                          </details>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ) : null}
            {showSlashOptionMenu && selectedSlashCommand ? (
              <div
                className="slash-menu slash-menu--options"
                data-testid="slash-options-menu"
                onWheel={(event) => event.stopPropagation()}
              >
                <div className="slash-menu__search">{selectedSlashCommand.title}</div>
                {slashOptions.length > 0 ? (
                  slashOptions.map((option) => (
                    <button
                      className={`slash-menu__option ${selectedSlashOption?.value === option.value ? "slash-menu__option--active" : ""}`}
                      key={option.value}
                      type="button"
                      onClick={() => onSelectSlashOption(option)}
                    >
                      <span className="slash-menu__option-title">{option.label}</span>
                      <span className="slash-menu__option-description">{option.description}</span>
                    </button>
                  ))
                ) : slashOptionEmptyState ? (
                  <div className="slash-menu__empty">
                    <div className="slash-menu__empty-title">{slashOptionEmptyState.title}</div>
                    <div className="slash-menu__empty-description">
                      {slashOptionEmptyState.description}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <textarea
          aria-label={textareaLabel}
          className={textareaClassName}
          data-testid={textareaTestId}
          ref={composerRef}
          value={composerDraft}
          onChange={(event) => {
            setComposerDraft(event.target.value);
          }}
          onKeyDown={onComposerKeyDown}
          placeholder={textareaPlaceholder}
        />
        <div className="composer__bar">
          <ComposerVoiceInput
            key={voiceKey}
            composerRef={composerRef}
            onInsert={(text, submit) => {
              const draft = composerRef.current?.value ?? composerDraft;
              const separator = draft && !/\s$/.test(draft) ? " " : "";
              const nextDraft = draft + separator + text;
              if (submit) pendingVoiceSubmission.current = { draft: nextDraft, key: voiceKey };
              setComposerDraft(nextDraft);
              composerRef.current?.focus();
            }}
            footer={footer}
          />
        </div>
      </div>
    </div>
  );
}

function MentionMenuSections({
  options,
  selectedIndex,
  onSelect,
  onEnableExtension,
}: {
  readonly options: readonly MentionOption[];
  readonly selectedIndex: number;
  readonly onSelect: (option: MentionOption) => void;
  readonly onEnableExtension: (option: ExtensionMentionOption) => void;
}) {
  const { t } = useTranslation();
  const extensionOptions = options.filter(
    (option): option is ExtensionMentionOption => option.kind === "extension",
  );
  const fileOptions = options.filter(
    (option): option is FileMentionOption => option.kind === "file",
  );

  return (
    <>
      {extensionOptions.length > 0 ? (
        <MentionMenuSection
          title={t("sidebar.extensions")}
          options={extensionOptions}
          selectedIndex={selectedIndex}
          allOptions={options}
          onSelect={onSelect}
          onEnableExtension={onEnableExtension}
        />
      ) : null}
      {fileOptions.length > 0 ? (
        <MentionMenuSection
          title={t("composer.files")}
          options={fileOptions}
          selectedIndex={selectedIndex}
          allOptions={options}
          onSelect={onSelect}
          onEnableExtension={onEnableExtension}
        />
      ) : null}
    </>
  );
}

function MentionMenuSection({
  title,
  options,
  selectedIndex,
  allOptions,
  onSelect,
  onEnableExtension,
}: {
  readonly title: string;
  readonly options: readonly MentionOption[];
  readonly selectedIndex: number;
  readonly allOptions: readonly MentionOption[];
  readonly onSelect: (option: MentionOption) => void;
  readonly onEnableExtension: (option: ExtensionMentionOption) => void;
}) {
  return (
    <div className="mention-menu__section">
      <div className="mention-menu__section-title">{title}</div>
      {options.map((option) => (
        <MentionMenuItem
          key={option.id}
          option={option}
          active={allOptions[selectedIndex]?.id === option.id}
          onSelect={onSelect}
          onEnableExtension={onEnableExtension}
        />
      ))}
    </div>
  );
}

function MentionMenuItem({
  option,
  active,
  onSelect,
  onEnableExtension,
}: {
  readonly option: MentionOption;
  readonly active: boolean;
  readonly onSelect: (option: MentionOption) => void;
  readonly onEnableExtension: (option: ExtensionMentionOption) => void;
}) {
  const { t } = useTranslation();
  if (option.kind === "extension") {
    return (
      <div
        className={`mention-menu__item mention-menu__item--extension ${active ? "mention-menu__item--active" : ""} ${option.enabled ? "" : "mention-menu__item--disabled"}`}
      >
        <button
          className="mention-menu__item-main"
          disabled={option.enabling}
          type="button"
          onClick={() => {
            if (option.enabled) {
              onSelect(option);
              return;
            }
            onEnableExtension(option);
          }}
        >
          <span className="mention-menu__icon" aria-hidden="true">
            <ExtensionIcon />
          </span>
          <span className="mention-menu__content">
            <span className="mention-menu__line">
              <span className="mention-menu__filename">{option.displayName}</span>
              {option.enabled ? null : (
                <span className="mention-menu__badge">
                  {t(option.enabling ? "composer.enabling" : "composer.disabled")}
                </span>
              )}
            </span>
            <span className="mention-menu__description">{option.description}</span>
          </span>
        </button>
        {option.enabled ? null : (
          <button
            aria-label={t("customize.enable", { name: option.displayName })}
            className="mention-menu__enable"
            disabled={option.enabling}
            type="button"
            onClick={() => onEnableExtension(option)}
          >
            {t(option.enabling ? "composer.enabling" : "composer.enable")}
          </button>
        )}
      </div>
    );
  }

  const lastSlash = option.filePath.lastIndexOf("/");
  const dirPart = lastSlash >= 0 ? option.filePath.slice(0, lastSlash + 1) : "";
  const namePart = lastSlash >= 0 ? option.filePath.slice(lastSlash + 1) : option.filePath;
  return (
    <button
      className={`mention-menu__item ${active ? "mention-menu__item--active" : ""}`}
      type="button"
      onClick={() => onSelect(option)}
    >
      <span className="mention-menu__icon" aria-hidden="true">
        <FileIcon />
      </span>
      <span className="mention-menu__file">
        {dirPart ? <span className="mention-menu__dirname">{dirPart}</span> : null}
        <span className="mention-menu__filename">{namePart}</span>
      </span>
    </button>
  );
}

function SlashCommandIcon({ command }: { readonly command: ComposerSlashCommand }) {
  switch (command.kind) {
    case "runtime":
      return command.runtimeCommand?.source === "skill" ? <SkillIcon /> : <SparkIcon />;
    case "model":
      return <ModelIcon />;
    case "thinking":
      return <ReasoningIcon />;
    case "status":
      return <StatusIcon />;
    default:
      return <SparkIcon />;
  }
}
