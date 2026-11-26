import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  Menu,
  nativeImage,
  nativeTheme,
  net,
  protocol,
  session,
  shell,
  type IncomingMessage,
  type MenuItemConstructorOptions,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from "electron";
import { isValidHttpBaseUrl } from "@pi-gui/pi-sdk-driver";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import type {
  AgentToolResult,
  ExtensionContext,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { json as readStreamJson } from "node:stream/consumers";
import { pathToFileURL } from "node:url";
import { augmentPosixPath } from "../scripts/augment-path.cjs";
import { DesktopAppStore } from "./application/app-store";
import { TOOL_IMAGE_SCHEME } from "../contracts/tool-output-images";
import { WindowOwner } from "./windows/window-owner";
import { PendingComposerDraftFlusher } from "./windows/pending-draft-flush";
import { windowChromeArguments, windowChromeOptions } from "./windows/window-chrome";
import { TurnCheckpointStore } from "./workbench/checkpoint-store";
import {
  DesktopExtensionViewOwner,
  DESKTOP_EXTENSION_SCHEME,
} from "./extensions/extension-view-owner";
import { performExtensionViewHostAction } from "./extensions/extension-view-actions";
import { extensionFrameDocument } from "./extensions/extension-frame-document";
import { ReviewOwner } from "./workbench/review-owner";
import { registerDesktopIpc } from "./ipc/register-desktop-ipc";
import type { NativeDialogLocale } from "../contracts/ipc";
import { nativeDialogCopy } from "./platform/native-dialog-copy";
import {
  createOrchestrationRuntimeExtension,
  createOrchestrationRuntimeTools,
  type OrchestrationRuntimeBridge,
} from "./orchestration/orchestration-runtime";
import {
  createScheduledTaskRuntimeExtension,
  createScheduledTaskRuntimeTools,
  type ScheduledTaskRuntimeBridge,
} from "./scheduled-tasks/scheduled-task-runtime";
import { getChangedFiles, getFileDiff, stageFile } from "./platform/files/app-store-diff";
import { listWorkspaceFiles, readWorkspaceFile } from "./platform/files/app-store-files";
import { resolveExistingWorkspacePath } from "./platform/files/workspace-paths";
import { MAIN_DEV_RELOAD_MARKER } from "./dev-reload-main-probe";
import { NotificationManager } from "./platform/notification-manager";
import { NotificationPermissionService } from "./platform/notification-permission";
import { checkForUpdate, initUpdateChecker, openReleasesPage } from "./platform/update-checker";
import { ThemeManager } from "./platform/theme-manager";
import { EditorService } from "./platform/editors/editor-service";
import { windowBackgroundFor } from "../contracts/theme";
import { TerminalService } from "./platform/terminal-service";
import { VoiceInput } from "./platform/voice-input";
import type { DesktopAppState, DesktopAppViewState } from "../contracts/desktop-state";
import {
  desktopCommands,
  desktopIpc,
  getDesktopCommandFromShortcut,
  isSinglePressCommand,
  isCloseFocusedSurfaceShortcut,
  getSidePanelTabCommand,
  platformShortcutModifier,
  type CustomProviderProbeInput,
  type CustomProviderProbeResult,
} from "../contracts/ipc";
import {
  assertComposerImageBytes,
  assertComposerImageFileSizes,
  assertComposerImagePixels,
  SUPPORTED_COMPOSER_IMAGE_TYPES,
  type ClipboardImageRead,
} from "../contracts/composer-attachments";
import type {
  ComposerAttachment,
  ComposerFileAttachment,
  ComposerImageAttachment,
} from "../contracts/desktop-state";
import type { SessionDriverEvent } from "@pi-gui/session-driver";
import type { GenerateThreadTitleOptions } from "@pi-gui/pi-sdk-driver";
import type { SessionRef, WorkspaceRef } from "@pi-gui/session-driver";

protocol.registerSchemesAsPrivileged([
  {
    scheme: DESKTOP_EXTENSION_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
  { scheme: TOOL_IMAGE_SCHEME, privileges: { standard: true, secure: true } },
]);

const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
const appTestMode = resolveAppTestMode(process.env.PI_APP_TEST_MODE);
const windowTestMode = appTestMode ?? "foreground";
const devReloadMarkersEnabled = process.env.PI_APP_DEV_RELOAD_MARKERS === "1";
const TURN_CAPTURE_BACKSTOP_MS = 10_000;
let store: DesktopAppStore;
let extensionViewOwner: DesktopExtensionViewOwner | undefined;
let windowOwner: WindowOwner;
let voiceInput: VoiceInput | undefined;
const themeManager = new ThemeManager();
const editorService = new EditorService();
let mainWindow: BrowserWindow | null = null;
let notificationManager: NotificationManager | undefined;
let notificationPermissionService: NotificationPermissionService | undefined;
let terminalService: TerminalService | undefined;
let integratedTerminalShell = "";
let applicationRelaunchRequested = false;

function requestApplicationRelaunch(): void {
  if (applicationRelaunchRequested) {
    return;
  }
  applicationRelaunchRequested = true;
  app.relaunch();
  app.quit();
}

interface OrchestrationRuntimeToolTestInput {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly sessionRef: SessionRef;
  readonly params: unknown;
}

interface ScheduledTaskRuntimeToolTestInput {
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly sessionRef: SessionRef;
  readonly params: unknown;
}

function createStoreBackedScheduledTaskRuntimeBridge(): ScheduledTaskRuntimeBridge {
  return {
    createScheduledTask: async (ctx, input) => {
      await store.initialize();
      return store.createScheduledTaskToolResult(sessionRefFromExtensionContext(ctx), input);
    },
    listScheduledTasks: async () => {
      await store.initialize();
      return store.listScheduledTasksToolResult();
    },
    updateScheduledTask: async (_ctx, input) => {
      await store.initialize();
      return store.updateScheduledTaskToolResult(input);
    },
  };
}

async function runScheduledTaskRuntimeToolForTest(
  bridge: ScheduledTaskRuntimeBridge,
  input: ScheduledTaskRuntimeToolTestInput,
): Promise<AgentToolResult<unknown>> {
  await store.initialize();
  const tool = createScheduledTaskRuntimeTools(bridge, () => input.sessionRef.workspaceId).find(
    (entry) => entry.name === input.toolName,
  );
  if (!tool) {
    throw new Error(`Unknown scheduled-task runtime tool: ${input.toolName}`);
  }
  return tool.execute(
    input.toolCallId ?? `test-${input.toolName}`,
    input.params,
    undefined,
    undefined,
    createTestExtensionContext(input.sessionRef),
  );
}

let stopNotifications: (() => void) | undefined;
let stopUpdateChecker: (() => void) | undefined;
let stopPruningTerminals: (() => void) | undefined;
let retainedTerminalWorkspacePathSignature = "";
const terminalFocusedWebContentsIds = new Set<number>();
const sidePanelFocusedWebContentsIds = new Set<number>();
const surfaceCloseShortcutIds = new Set<number>();
// "flushing" while quit saves drafts and the store; "done" once quit may proceed.
let quitFlush: "idle" | "flushing" | "done" = "idle";

const SUPPORTED_IMAGE_TYPES = SUPPORTED_COMPOSER_IMAGE_TYPES;
const SUPPORTED_IMAGE_MIME_TYPES = new Set<string>(
  SUPPORTED_IMAGE_TYPES.map((type) => type.mimeType),
);
const NEW_WINDOW_MENU_ITEM_ID = "file.new-window";

function createStoreBackedOrchestrationRuntimeBridge(): OrchestrationRuntimeBridge {
  return {
    archiveChildThreads: async (ctx, threadIds) => {
      await store.initialize();
      return store.archiveChildThreadsToolResult(sessionRefFromExtensionContext(ctx), threadIds);
    },
    createChildThread: async (ctx, input) => {
      await store.initialize();
      return store.createChildThreadToolResult(sessionRefFromExtensionContext(ctx), input);
    },
    listThreads: async (ctx, input) => {
      await store.initialize();
      return store.listThreadsToolResult(sessionRefFromExtensionContext(ctx), input.workspace);
    },
    readThread: async (ctx, threadId) => {
      await store.initialize();
      return store.readThreadToolResult(sessionRefFromExtensionContext(ctx), threadId);
    },
    sendMessageToThread: async (ctx, input) => {
      await store.initialize();
      return store.sendMessageToThreadToolResult(sessionRefFromExtensionContext(ctx), input);
    },
  };
}

function sessionRefFromExtensionContext(ctx: ExtensionContext): SessionRef {
  const sessionId = ctx.sessionManager.getSessionId();
  const cwd = path.resolve(ctx.sessionManager.getCwd?.() ?? ctx.cwd);
  const sessionRef = store.findSessionRefByCwdAndSessionId(cwd, sessionId);
  if (!sessionRef) {
    throw new Error(`Unable to resolve orchestration session for ${cwd}:${sessionId}`);
  }
  return sessionRef;
}

async function runOrchestrationRuntimeToolForTest(
  bridge: OrchestrationRuntimeBridge,
  input: OrchestrationRuntimeToolTestInput,
): Promise<AgentToolResult<unknown>> {
  await store.initialize();
  const tool = createOrchestrationRuntimeTools(bridge).find(
    (entry) => entry.name === input.toolName,
  );
  if (!tool) {
    throw new Error(`Unknown orchestration runtime tool: ${input.toolName}`);
  }
  return tool.execute(
    input.toolCallId ?? `test-${input.toolName}`,
    input.params,
    undefined,
    undefined,
    createTestExtensionContext(input.sessionRef),
  );
}

function createTestExtensionContext(sessionRef: SessionRef): ExtensionToolContext {
  const workspace = store
    .snapshot()
    .workspaces.find(
      (entry) =>
        entry.id === sessionRef.workspaceId &&
        entry.sessions.some((session) => session.id === sessionRef.sessionId),
    );
  if (!workspace) {
    throw new Error(`Unknown test session: ${sessionRef.workspaceId}:${sessionRef.sessionId}`);
  }

  return {
    hasUI: false,
    mode: "json",
    cwd: workspace.path,
    sessionManager: {
      getSessionId: () => sessionRef.sessionId,
      getCwd: () => workspace.path,
    } as ExtensionContext["sessionManager"],
    ui: {} as ExtensionContext["ui"],
    modelRegistry: {} as ExtensionContext["modelRegistry"],
    scopedModels: [],
    model: undefined,
    signal: undefined,
    isIdle: () => true,
    isProjectTrusted: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
    tools: [],
    executeTool: () => Promise.reject(new Error("Nested tool calls are not available in tests")),
  };
}
const OPEN_FOLDER_MENU_ITEM_ID = "file.open-folder";
const CHECK_FOR_UPDATES_MENU_ITEM_ID = "app.check-for-updates";
const QUIT_FLUSH_TIMEOUT_MS = 5_000;
// Part of the quit budget above: renderers get this long to send their debounced drafts.
const DRAFT_FLUSH_TIMEOUT_MS = 2_000;
const composerDraftFlusher = new PendingComposerDraftFlusher(DRAFT_FLUSH_TIMEOUT_MS);
// Windows whose draft was flushed and whose close is now allowed through.
const windowsClosingAfterDraftFlush = new WeakSet<BrowserWindow>();

function getTerminalService(): TerminalService {
  if (!terminalService) {
    terminalService = new TerminalService({
      getWorkspacePath: (workspaceId) => store.getWorkspacePath(workspaceId),
      getIntegratedTerminalShell: () => integratedTerminalShell,
      isPackaged: app.isPackaged,
    });
  }
  return terminalService;
}

// Resolve the bundled application icon. In dev the repo's `resources/icon.png`
// sits two levels up from the compiled `out/main/main.js`; in a packaged build
// it is copied to `process.resourcesPath` via `extraResources` in
// electron-builder.yml. On macOS packaged builds the window/dock icon already
// comes from `icon.icns` in the app bundle, so we only need the PNG for dev
// and for Linux/Windows window chrome.
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "..", "..", "resources", "icon.png");
const appIcon = nativeImage.createFromPath(appIconPath);

function parseExternalWebUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function appRendererUrl(): string {
  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    return process.env.ELECTRON_RENDERER_URL;
  }
  const indexPath = path.join(__dirname, "..", "renderer", "index.html");
  return pathToFileURL(indexPath).toString();
}

function allowMicrophone(
  contents: Electron.WebContents | null,
  details: { readonly isMainFrame: boolean; readonly requestingUrl?: string },
): boolean {
  return (
    details.isMainFrame &&
    details.requestingUrl === new URL(appRendererUrl()).href &&
    windowOwner.allWindows().some((window) => window.webContents === contents)
  );
}

function isInAppNavigationUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const appUrl = new URL(appRendererUrl());
    return parsed.href === appUrl.href || (isDev && parsed.origin === appUrl.origin);
  } catch {
    return false;
  }
}

function openExternalWebUrl(url: string): boolean {
  const parsed = parseExternalWebUrl(url);
  if (!parsed) {
    return false;
  }
  void shell.openExternal(parsed.toString()).catch((error) => {
    console.error(`Failed to open external URL: ${parsed.toString()}`, error);
  });
  return true;
}

/** MCP sign-in pages: any https URL, or http only on this machine (a local OAuth server). */
const nativeDialogLocales = new WeakMap<BrowserWindow, NativeDialogLocale>();

function nativeLocaleFor(window: BrowserWindow | undefined): NativeDialogLocale {
  const locale = window ? nativeDialogLocales.get(window) : undefined;
  return locale ?? (/^ja(?:[-_]|$)/i.test(app.getLocale()) ? "ja" : "en");
}

function dialogCopyFor(window: BrowserWindow | undefined) {
  return nativeDialogCopy[nativeLocaleFor(window)];
}

function openMcpSignInUrl(url: string): void {
  const parsed = parseExternalWebUrl(url);
  const loopback =
    parsed?.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase());
  if (!parsed || (parsed.protocol !== "https:" && !loopback)) {
    // Sign-in URLs carry state and codes in their query, so logs name the origin at most.
    console.error(
      `Refusing to open an MCP sign-in URL${parsed ? ` on ${parsed.origin}` : " that is not http or https"}`,
    );
    showMcpSignInUrl(url, "localLinkOnly");
    return;
  }
  shell.openExternal(parsed.toString()).catch((error: unknown) => {
    console.error(`Failed to open an MCP sign-in URL on ${parsed.origin}`, error);
    showMcpSignInUrl(parsed.toString(), "browserUnavailable");
  });
}

/** When the browser cannot be opened, the link is shown so the person can copy it. */
function showMcpSignInUrl(url: string, reason: "localLinkOnly" | "browserUnavailable"): void {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const copy = dialogCopyFor(window);
  const options: MessageBoxOptions = {
    type: "warning",
    title: "pi-gui",
    message: copy.mcpLinkTitle,
    detail: `${copy[reason]} ${copy.checkLink}\n\n${url}`,
    buttons: [copy.copyLink, copy.close],
    defaultId: 0,
    cancelId: 1,
  };
  (window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options))
    .then(({ response }) => {
      if (response === 0) clipboard.writeText(url);
    })
    .catch((error: unknown) => {
      console.error("Failed to show the MCP sign-in link", error);
    });
}

async function openExternalLink(url: string): Promise<void> {
  const parsed = parseExternalWebUrl(url);
  if (!parsed) {
    throw new Error(`Refusing to open unsupported URL: ${url}`);
  }
  await shell.openExternal(parsed.toString());
}

function readClipboardImageAttachment(): ClipboardImageRead {
  const image = clipboard.readImage();
  if (image.isEmpty()) {
    return { ok: false };
  }

  const size = image.getSize();
  try {
    assertComposerImagePixels(size.width, size.height);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const png = image.toPNG();
  if (png.length === 0) {
    return { ok: false };
  }
  try {
    assertComposerImageBytes(png.length);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    ok: true,
    attachment: {
      id: randomUUID(),
      kind: "image",
      name: "pasted-image.png",
      mimeType: "image/png",
      data: png.toString("base64"),
    },
  };
}

function dispatchCloseFocusedSurface(window: BrowserWindow, event: Electron.Event): void {
  event.preventDefault();
  const webContentsId = window.webContents.id;
  surfaceCloseShortcutIds.add(webContentsId);
  setImmediate(() => {
    surfaceCloseShortcutIds.delete(webContentsId);
  });
  window.webContents.send(desktopIpc.appCommand, desktopCommands.closeFocusedSurface);
}

// The native window colour matches the renderer's theme, so load, reload and
// resize never flash another theme's colour.
function currentWindowBackground(): string {
  return windowBackgroundFor(
    store?.snapshot().themePresetId ?? "default",
    themeManager.getResolvedTheme(),
  );
}

// Windows created transparent keep their glass until the next launch.
const opaqueAppWindows = new Set<BrowserWindow>();

function refreshWindowBackgrounds(): void {
  if (!store) return;
  const color = currentWindowBackground();
  for (const window of opaqueAppWindows) {
    if (!window.isDestroyed()) window.setBackgroundColor(color);
  }
}

function createWindow(): BrowserWindow {
  const backgroundTestMode = windowTestMode === "background";
  const enableTransparency = store ? store.snapshot().enableTransparency : false;
  const window = new BrowserWindow({
    width: 1480,
    height: 980,
    minWidth: 560,
    minHeight: 600,
    transparent: enableTransparency,
    vibrancy: process.platform === "darwin" && enableTransparency ? "under-window" : undefined,
    ...windowChromeOptions(process.platform),
    backgroundColor: enableTransparency ? "#00000000" : currentWindowBackground(),
    show: false,
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep hidden test windows responsive so Playwright exercises the same UI flows.
      backgroundThrottling: !backgroundTestMode,
      additionalArguments: windowChromeArguments(process.platform),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isInAppNavigationUrl(url)) {
      openExternalWebUrl(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-frame-navigate", (event) => {
    if (event.isMainFrame) return;
    try {
      const url = new URL(event.url);
      if (
        url.protocol !== `${DESKTOP_EXTENSION_SCHEME}:` ||
        url.pathname !== "/" ||
        url.search ||
        url.hash
      )
        throw new Error("Unexpected frame navigation");
      if (!extensionViewOwner) throw new Error("Extension host unavailable");
      extensionViewOwner.getConnectionContext(url.hostname, window.webContents.id);
    } catch {
      event.preventDefault();
    }
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (isInAppNavigationUrl(url)) {
      return;
    }
    event.preventDefault();
    openExternalWebUrl(url);
  });

  window.on("close", (event) => {
    if (surfaceCloseShortcutIds.has(window.webContents.id)) {
      event.preventDefault();
      surfaceCloseShortcutIds.delete(window.webContents.id);
      return;
    }
    // Quit flushes every window's draft and then the store before it closes any window. A
    // close during that flush would drop this window's draft, and closing the last window
    // would re-enter quit and skip the store flush, so quit closes it once the flush ends.
    if (quitFlush === "flushing") {
      event.preventDefault();
      return;
    }
    if (quitFlush === "done" || windowsClosingAfterDraftFlush.delete(window)) return;
    // Otherwise hold this close until the renderer sends its debounced draft, since closing
    // the window would discard it.
    event.preventDefault();
    void composerDraftFlusher
      .flush([window])
      .finally(() => {
        if (window.isDestroyed()) return;
        windowsClosingAfterDraftFlush.add(window);
        window.close();
      })
      .catch((error: unknown) => {
        console.error("[main] Closing the window after its draft flush failed", error);
      });
  });
  window.once("ready-to-show", () => {
    if (!backgroundTestMode) {
      window.show();
    }
  });
  window.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") {
      return;
    }

    // Side panel tab chords act from the terminal and extension views too. The
    // key is not consumed: that would also swallow the modifier's keyup, leaving
    // the tab hints up, and on Windows and Linux it would let the Alt release
    // open the hidden menu bar. The page takes no default action for these keys,
    // and the renderer's own handling of the same keydown is idempotent.
    const sidePanelTabCommand = getSidePanelTabCommand(process.platform, input);
    if (sidePanelTabCommand) {
      if (!input.isAutoRepeat) window.webContents.send(desktopIpc.appCommand, sidePanelTabCommand);
      return;
    }

    const lowerKey = input.key.toLowerCase();
    const platformModifier = platformShortcutModifier(process.platform, input);
    const command = getDesktopCommandFromShortcut({
      modifier: platformModifier,
      alt: input.alt,
      shift: input.shift,
      key: input.key,
      code: input.code,
    });
    const webContentsId = window.webContents.id;
    const terminalFocused = terminalFocusedWebContentsIds.has(webContentsId);
    const closeFocusedSurface =
      isCloseFocusedSurfaceShortcut({
        meta: input.meta,
        control: input.control,
        alt: input.alt,
        shift: input.shift,
        key: input.key,
        code: input.code,
        platform: process.platform,
      }) &&
      (terminalFocused || sidePanelFocusedWebContentsIds.has(webContentsId));
    if (terminalFocused) {
      // Control chords belong to the shell, so only macOS Command chords open
      // a palette or act on the thread from the terminal. New Tab stays with the
      // terminal, which opens another shell.
      if (
        process.platform === "darwin" &&
        isSinglePressCommand(command) &&
        command !== desktopCommands.newSidePanelTab
      ) {
        event.preventDefault();
        if (!input.isAutoRepeat) window.webContents.send(desktopIpc.appCommand, command);
      } else if (command === desktopCommands.toggleSidePanel) {
        event.preventDefault();
        window.webContents.send(desktopIpc.appCommand, command);
      } else if (closeFocusedSurface) {
        dispatchCloseFocusedSurface(window, event);
      }
      return;
    }
    if (closeFocusedSurface) {
      dispatchCloseFocusedSurface(window, event);
      return;
    }
    if (platformModifier && input.shift && lowerKey === "n") {
      event.preventDefault();
      createAppWindow(windowOwner.viewForWindow(window));
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "o") {
      event.preventDefault();
      void pickWorkspaceViaDialog(window).catch((error: unknown) => {
        console.error("[main] pickWorkspaceViaDialog failed", error);
      });
      return;
    }

    if (platformModifier && !input.shift && lowerKey === "v") {
      const clipboardImage = readClipboardImageAttachment();
      if (clipboardImage.ok || clipboardImage.message) {
        event.preventDefault();
        window.webContents.send(desktopIpc.clipboardImagePasted, clipboardImage);
        return;
      }
    }

    if (command) {
      event.preventDefault();
      // Holding a palette chord would open and close it at the repeat rate.
      if (isSinglePressCommand(command) && input.isAutoRepeat) {
        return;
      }
      window.webContents.send(desktopIpc.appCommand, command);
    }
  });

  if (isDev) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL as string).catch((error: unknown) => {
      console.error("[main] loadURL failed", error);
    });
    if (process.env.PI_APP_OPEN_DEVTOOLS !== "0") {
      window.webContents.openDevTools({ mode: "detach" });
    }
  } else {
    void window.loadURL(appRendererUrl()).catch((error: unknown) => {
      console.error("[main] loadURL failed", error);
    });
  }

  if (!enableTransparency) {
    opaqueAppWindows.add(window);
    window.once("closed", () => opaqueAppWindows.delete(window));
  }

  return window;
}

function createAppWindow(sourceView?: DesktopAppViewState): BrowserWindow {
  const window = createWindow();
  const webContentsId = window.webContents.id;
  windowOwner.add(window, sourceView);
  themeManager.trackWindow(window);
  if (process.platform === "win32") {
    installWindowsMenu(window);
    window.on("focus", () => installWindowsMenu(window));
  }

  window.once("closed", () => {
    windowOwner.remove(window);
    terminalFocusedWebContentsIds.delete(webContentsId);
    sidePanelFocusedWebContentsIds.delete(webContentsId);
    surfaceCloseShortcutIds.delete(webContentsId);
    terminalService?.disposeWebContents(webContentsId);
    void store
      .cancelPendingDialogsWithoutVisibleWindow((sessionRef) =>
        windowOwner.isSessionVisibleInAnotherWindow(sessionRef),
      )
      .catch((error: unknown) => {
        console.error("[main] cancelPendingDialogsWithoutVisibleWindow failed", error);
      });
    if (windowOwner.size() === 0) {
      terminalService?.dispose();
      terminalService = undefined;
    }
  });

  return window;
}

function canPublishToWindow(window: BrowserWindow): boolean {
  return (
    !window.isDestroyed() && !window.webContents.isDestroyed() && !window.webContents.isCrashed()
  );
}

function resolveAppTestMode(value: string | undefined): "foreground" | "background" | undefined {
  return value === "foreground" || value === "background" ? value : undefined;
}

function resolveDialogWindow(parentWindow?: BrowserWindow | null): BrowserWindow | undefined {
  return windowOwner.resolveDialogWindow(parentWindow);
}

async function stateForWindow(window?: BrowserWindow | null): Promise<DesktopAppState> {
  return windowOwner.stateForWindow(window);
}

function runWindowScopedForWindow(
  window: BrowserWindow | null | undefined,
  action: () => Promise<DesktopAppState>,
  options: { readonly forceActiveWindow?: boolean } = {},
): Promise<DesktopAppState> {
  return windowOwner.runStateAction(window, action, options);
}

async function pickWorkspacePathViaDialog(
  parentWindow?: BrowserWindow | null,
): Promise<string | undefined> {
  const window = resolveDialogWindow(parentWindow);
  const options: OpenDialogOptions = {
    properties: ["openDirectory"],
    title: dialogCopyFor(window ?? undefined).openFolder,
  };
  const result = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }
  return result.filePaths[0] as string;
}

async function addPickedWorkspace(
  window: BrowserWindow | null | undefined,
  workspacePath: string,
): Promise<DesktopAppState> {
  const nextState = await store.addWorkspace(workspacePath);
  if (!nextState.selectedWorkspaceId) {
    return nextState;
  }
  const newThreadState =
    nextState.activeView === "new-thread" ? nextState : await store.setActiveView("new-thread");
  if (window) {
    window.webContents.send(desktopIpc.workspacePicked, nextState.selectedWorkspaceId);
  }
  return newThreadState;
}

async function pickWorkspaceViaDialog(
  parentWindow?: BrowserWindow | null,
): Promise<DesktopAppState> {
  const window = resolveDialogWindow(parentWindow);
  const workspacePath = await pickWorkspacePathViaDialog(window);
  if (!workspacePath) {
    return stateForWindow(window);
  }
  return runWindowScopedForWindow(window, () => addPickedWorkspace(window, workspacePath));
}

async function runManualUpdateCheck(): Promise<void> {
  const window = mainWindow && canPublishToWindow(mainWindow) ? mainWindow : undefined;
  const showDialog = (options: MessageBoxOptions) =>
    window ? dialog.showMessageBox(window, options) : dialog.showMessageBox(options);

  try {
    const result = await checkForUpdate();

    if (result.status === "update-available") {
      // The manual menu path always confirms with a dialog — a notification may
      // be silently suppressed if the OS permission is denied.
      const choice = await showDialog({
        type: "info",
        title: "pi-gui",
        message: `Version ${result.latestVersion} is available.`,
        detail: `You have ${result.currentVersion}.`,
        buttons: ["Download", "Later"],
        defaultId: 0,
        cancelId: 1,
      });
      if (choice.response === 0) {
        await openReleasesPage(result.releaseUrl);
      }
      return;
    }

    if (result.status === "up-to-date") {
      await showDialog({
        type: "info",
        title: "pi-gui",
        message: `You're up to date on version ${result.currentVersion}.`,
        buttons: ["OK"],
      });
      return;
    }

    await showDialog({
      type: "warning",
      title: "pi-gui",
      message: "Could not check for updates right now.",
      detail: result.message,
      buttons: ["OK"],
    });
  } catch (error) {
    console.error("pi-gui: manual update check failed:", error);
    await showDialog({
      type: "warning",
      title: "pi-gui",
      message: "Could not check for updates right now.",
      detail: error instanceof Error ? error.message : String(error),
      buttons: ["OK"],
    }).catch(() => undefined);
  }
}

let windowsMenuLocale: NativeDialogLocale | undefined;

function installWindowsMenu(window: BrowserWindow): void {
  const locale = nativeLocaleFor(window);
  if (windowsMenuLocale === locale) return;
  const ja = locale === "ja";
  const activeWindow = () => BrowserWindow.getFocusedWindow() ?? mainWindow;
  const label = (jaText: string, enText: string) => (ja ? jaText : enText);
  const version = app.getVersion();
  const showHelp = (message: string, detail: string) => {
    const parent = activeWindow();
    if (!parent) return;
    void dialog
      .showMessageBox(parent, {
        type: "info",
        title: "Pi-GUI",
        message,
        detail,
        buttons: [nativeDialogCopy[locale].close],
      })
      .catch((error: unknown) => console.error("[main] show Windows help failed", error));
  };
  const template: MenuItemConstructorOptions[] = [
    {
      label: label("ファイル(&F)", "&File"),
      submenu: [
        {
          label: label("新しい会話", "New Thread"),
          accelerator: "Ctrl+N",
          click: () =>
            activeWindow()?.webContents.send(desktopIpc.appCommand, desktopCommands.openNewThread),
        },
        {
          label: label("新しいウィンドウ", "New Window"),
          accelerator: "Ctrl+Shift+N",
          click: () => createAppWindow(windowOwner.foregroundView()),
        },
        {
          label: label("フォルダを開く…", "Open Folder…"),
          accelerator: "Ctrl+O",
          click: () =>
            void pickWorkspaceViaDialog(activeWindow()).catch((error: unknown) => {
              console.error("[main] pickWorkspaceViaDialog failed", error);
            }),
        },
        { type: "separator" },
        { role: "close", label: label("ウィンドウを閉じる", "Close Window") },
      ],
    },
    {
      label: label("編集(&E)", "&Edit"),
      submenu: [
        { role: "undo", label: label("元に戻す", "Undo") },
        { role: "redo", label: label("やり直す", "Redo") },
        { type: "separator" },
        { role: "cut", label: label("切り取り", "Cut") },
        { role: "copy", label: label("コピー", "Copy") },
        { role: "paste", label: label("貼り付け", "Paste") },
        { role: "selectAll", label: label("すべて選択", "Select All") },
      ],
    },
    {
      label: label("表示(&V)", "&View"),
      submenu: [
        { role: "resetZoom", label: label("実際のサイズ", "Actual Size") },
        { role: "zoomIn", label: label("拡大", "Zoom In") },
        { role: "zoomOut", label: label("縮小", "Zoom Out") },
        { role: "togglefullscreen", label: label("全画面表示を切り替える", "Toggle Full Screen") },
      ],
    },
    {
      label: label("ヘルプ(&H)", "&Help"),
      submenu: [
        {
          label: label("Pi の使い方", "Using Pi"),
          click: () =>
            showHelp(
              label("Pi の使い方", "Using Pi"),
              label(
                "設定で使うモデルを選び、会話の入力欄に依頼を入力します。プロジェクトを選ぶと、そのフォルダで作業できます。入力欄で「/」を入力すると、使えるコマンドやスキルを確認できます。",
                "Choose a model in Settings and enter a request in the conversation. Select a project to work in its folder. Type / in the composer to see available commands and skills.",
              ),
            ),
        },
        {
          label: label("Pi-GUI の機能", "Pi-GUI Features"),
          click: () =>
            showHelp(
              label("Pi-GUI の機能", "Pi-GUI Features"),
              label(
                "「チャット」ではフォルダを選ばずに相談できます。「プロジェクトで続ける」から要点を引き継げます。プロジェクトの会話では右ペインからファイル、差分、ターミナルを開けます。",
                "Use Chat to talk without choosing a folder. Continue in Project carries the context into a project. In a project conversation, use the side panel to open files, review changes, or use the terminal.",
              ),
            ),
        },
        {
          id: "windows-skills",
          label: label("利用可能なスキル", "Available Skills"),
          click: () =>
            activeWindow()?.webContents.send(desktopIpc.appCommand, desktopCommands.openSkills),
        },
        { type: "separator" },
        { label: label(`バージョン ${version}`, `Version ${version}`), enabled: false },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  windowsMenuLocale = locale;
}

function installApplicationMenu(): void {
  if (process.platform !== "darwin") {
    return;
  }

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        {
          id: CHECK_FOR_UPDATES_MENU_ITEM_ID,
          label: "Check for Updates…",
          click: () => {
            void runManualUpdateCheck().catch((error: unknown) => {
              console.error("[main] runManualUpdateCheck failed", error);
            });
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "File",
      submenu: [
        {
          label: "New Thread",
          accelerator: "CommandOrControl+N",
          click: () => {
            const window = BrowserWindow.getFocusedWindow() ?? mainWindow;
            window?.webContents.send(desktopIpc.appCommand, desktopCommands.openNewThread);
          },
        },
        {
          id: NEW_WINDOW_MENU_ITEM_ID,
          label: "New Window",
          accelerator: "CommandOrControl+Shift+N",
          click: () => {
            createAppWindow(windowOwner.foregroundView());
          },
        },
        { type: "separator" },
        {
          id: OPEN_FOLDER_MENU_ITEM_ID,
          label: "Open Folder…",
          accelerator: "Command+O",
          click: () => {
            void pickWorkspaceViaDialog(mainWindow).catch((error: unknown) => {
              console.error("[main] pickWorkspaceViaDialog failed", error);
            });
          },
        },
        { type: "separator" },
        { role: "close" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        // Cmd+R toggles Review and Shift+Cmd+R renames the thread, so neither
        // reload has a shortcut.
        {
          label: "Reload",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.reload(),
        },
        {
          label: "Force Reload",
          click: () => BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache(),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Ensure npm (and other Homebrew/npm-global binaries) are available even when
// pi-gui is launched via Finder/Dock (which hands the process a minimal PATH).
// POSIX-only; on Windows the PATH is left untouched (see augmentPosixPath).
// Tests that need an exact PATH (no gh, say, on a Mac runner whose Homebrew has one) opt out.
const augmentedPath = augmentPosixPath();
if (augmentedPath.changed && !(appTestMode && process.env.PI_APP_TEST_EXACT_PATH === "1")) {
  process.env.PATH = augmentedPath.path;
}

app.setName("pi");

const configuredUserDataDir = process.env.PI_APP_USER_DATA_DIR?.trim() || app.getPath("userData");
app.setPath("userData", configuredUserDataDir);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  // app.quit() before ready can leave a windowless macOS process alive.
  // Duplicate instances have no store or windows, so exit immediately.
  app.exit(0);
}

app.on("second-instance", () => {
  const window = windowOwner.foreground();
  if (!window) {
    return;
  }
  if (window.isMinimized()) {
    window.restore();
  }
  window.show();
  window.focus();
});

app
  .whenReady()
  .then(async () => {
    if (!hasSingleInstanceLock) {
      return;
    }

    // On macOS, packaged builds already render the dock icon from `icon.icns`
    // in the app bundle. In dev we override the generic Electron dock icon with
    // the real PNG so the running app looks right end-to-end.
    if (process.platform === "darwin" && !app.isPackaged) {
      app.dock?.setIcon(appIcon);
    }

    let generateThreadTitleOverride:
      | ((
          workspace: WorkspaceRef,
          options: GenerateThreadTitleOptions,
        ) => Promise<string | null | undefined>)
      | undefined;
    let deferredThreadTitle:
      | {
          resolve: (title: string | null) => void;
          reject: (error: Error) => void;
        }
      | undefined;
    const orchestrationRuntimeBridge = createStoreBackedOrchestrationRuntimeBridge();
    const scheduledTaskRuntimeBridge = createStoreBackedScheduledTaskRuntimeBridge();
    const checkpoints = new TurnCheckpointStore(configuredUserDataDir);
    const extensionViews: DesktopExtensionViewOwner = new DesktopExtensionViewOwner({
      frameDocument: extensionFrameDocument,
      hostAssets: {
        "frame-bridge.js": {
          body: await readFile(
            createRequire(__filename).resolve("@pi-gui/extension-ui/frame-bridge"),
            "utf8",
          ),
          contentType: "text/javascript; charset=utf-8",
        },
      },
      onHostAction: (context) =>
        performExtensionViewHostAction(
          {
            store,
            windows: windowOwner,
            views: extensionViews,
            openExternal: openExternalLink,
            saveComposerDraft: (window) => composerDraftFlusher.flush([window]),
          },
          context,
        ),
      onDiagnostic: (target, source, message) =>
        console.error("[extension-view]", target.sessionId, source, message),
    });
    extensionViewOwner = extensionViews;
    protocol.handle(DESKTOP_EXTENSION_SCHEME, (request) =>
      extensionViews.assetResponse(request.url),
    );
    const driverOptions: NonNullable<
      ConstructorParameters<typeof DesktopAppStore>[0]["driverOptions"]
    > = {
      onTurnCaptureBoundary: (boundary, signal) => checkpoints.recordBoundary(boundary, signal),
      // The store bounds each capture from when it starts; this only stops a stuck boundary,
      // including one waiting behind another run's capture in the same checkout.
      turnCaptureTimeoutMs: TURN_CAPTURE_BACKSTOP_MS,
      desktopExtensions: {
        onChanged: (runtime) => extensionViews.replaceRuntime(runtime),
        onInvalidated: ({ target, generation }) =>
          extensionViews.invalidateRuntime(target, generation),
      },
      openUrl: openMcpSignInUrl,
      builtinExtensions: [
        {
          name: "pi-gui-thread-orchestration",
          displayName: "Thread orchestration",
          description: "Lets pi start, read and message other pi-gui threads",
          factory: createOrchestrationRuntimeExtension(orchestrationRuntimeBridge),
        },
        {
          name: "pi-gui-scheduled-tasks",
          displayName: "Scheduled tasks",
          description: "Lets pi create and update local pi-gui scheduled tasks",
          factory: createScheduledTaskRuntimeExtension(scheduledTaskRuntimeBridge, (ctx) => {
            try {
              return sessionRefFromExtensionContext(ctx).workspaceId;
            } catch {
              return undefined;
            }
          }),
        },
      ],
    };
    store = new DesktopAppStore({
      userDataDir: configuredUserDataDir,
      initialWorkspacePaths: resolveInitialWorkspacePaths(),
      getWindow: () => mainWindow,
      shouldKeepSessionDialogs: (sessionRef) =>
        windowOwner?.isSessionVisibleInAnotherWindow(sessionRef) ?? false,
      driverOptions,
      generateThreadTitleOverride: async (workspace, options) =>
        generateThreadTitleOverride?.(workspace, options),
    });
    protocol.handle(TOOL_IMAGE_SCHEME, (request) => store.transcriptImageResponse(request.url));
    windowOwner = new WindowOwner(store, {
      onActiveWindowChanged: (window) => {
        mainWindow = window;
        notificationManager?.trackWindow(window);
        notificationPermissionService?.trackWindow(window);
      },
    });
    const voiceRuntime =
      process.platform === "win32" && process.arch === "x64"
        ? path.join(
            app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), "build"),
            "whisper",
            "whisper-cli.exe",
          )
        : undefined;
    if (voiceRuntime) {
      session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
        permission === "media"
          ? details.mediaType === "audio" && allowMicrophone(contents, details)
          : permission !== "deprecated-sync-clipboard-read",
      );
      session.defaultSession.setPermissionRequestHandler(
        (contents, permission, respond, details) => {
          if (permission !== "media") {
            respond(true);
            return;
          }
          respond(
            "mediaTypes" in details &&
              details.mediaTypes?.length === 1 &&
              details.mediaTypes[0] === "audio" &&
              allowMicrophone(contents, details),
          );
        },
      );
    }
    voiceInput = new VoiceInput(voiceRuntime, app.getPath("userData"));
    await store.initialize();
    themeManager.setMode(store.snapshot().themeMode);
    integratedTerminalShell = (await store.getState()).integratedTerminalShell;
    nativeTheme.on("updated", refreshWindowBackgrounds);
    let windowBackgroundPresetId = store.snapshot().themePresetId;
    stopPruningTerminals = store.subscribe((state) => {
      integratedTerminalShell = state.integratedTerminalShell;
      if (state.themePresetId !== windowBackgroundPresetId) {
        windowBackgroundPresetId = state.themePresetId;
        refreshWindowBackgrounds();
      }
      const workspacePaths = state.workspaces.map((workspace) => workspace.path);
      const workspacePathSignature = workspacePaths.join("\0");
      if (workspacePathSignature !== retainedTerminalWorkspacePathSignature) {
        retainedTerminalWorkspacePathSignature = workspacePathSignature;
        terminalService?.retainWorkspacePaths(workspacePaths);
      }
    });
    installApplicationMenu();
    if (process.env.PI_APP_TEST_MODE) {
      Object.assign(globalThis, {
        __PI_APP_TEST_HOOKS: {
          emitSessionEvent: (event: SessionDriverEvent) => store.emitTestSessionEvent(event),
          handleWindowActivation: () => {
            if (mainWindow) {
              windowOwner.activate(mainWindow);
            }
          },
          promptForText: (message: string, placeholder?: string, allowEmpty?: boolean) =>
            promptForText(mainWindow, message, placeholder ?? "", allowEmpty ?? false),
          runOrchestrationRuntimeTool: (input: OrchestrationRuntimeToolTestInput) =>
            runOrchestrationRuntimeToolForTest(orchestrationRuntimeBridge, input),
          runScheduledTaskRuntimeTool: (input: ScheduledTaskRuntimeToolTestInput) =>
            runScheduledTaskRuntimeToolForTest(scheduledTaskRuntimeBridge, input),
          fireDueScheduledTasks: (nowIso?: string) =>
            store.fireDueScheduledTasks(nowIso ? new Date(nowIso) : undefined),
          setDeferredThreadTitleMode: () => {
            generateThreadTitleOverride = () =>
              new Promise<string | null>((resolve, reject) => {
                deferredThreadTitle = { resolve, reject };
              });
          },
          hasDeferredThreadTitle: () => Boolean(deferredThreadTitle),
          resolveDeferredThreadTitle: (title: string) => {
            if (!deferredThreadTitle) {
              throw new Error("Deferred thread-title request is unavailable");
            }
            const pending = deferredThreadTitle;
            deferredThreadTitle = undefined;
            pending.resolve(title);
          },
          rejectDeferredThreadTitle: () => {
            if (!deferredThreadTitle) {
              throw new Error("Deferred thread-title request is unavailable");
            }
            const pending = deferredThreadTitle;
            deferredThreadTitle = undefined;
            pending.reject(new Error("Deferred thread-title rejected by test"));
          },
        },
      });
    }
    notificationPermissionService = new NotificationPermissionService(() => mainWindow);
    notificationPermissionService.subscribe((status) => {
      for (const window of windowOwner.allWindows()) {
        if (canPublishToWindow(window)) {
          window.webContents.send(desktopIpc.notificationPermissionStatusChanged, status);
        }
      }
    });
    notificationManager = new NotificationManager(
      store,
      () => mainWindow,
      notificationPermissionService,
      () => dialogCopyFor(mainWindow ?? undefined),
      async (sessionRef) => {
        const window = windowOwner.foreground();
        await runWindowScopedForWindow(window, () => store.selectSession(sessionRef), {
          forceActiveWindow: true,
        });
      },
    );
    stopNotifications = notificationManager.start();
    if (!isDev) {
      stopUpdateChecker = initUpdateChecker();
    }

    registerDesktopIpc({
      windows: windowOwner,
      voiceInput,
      owners: {
        state: store,
        workbench: store,
        extensionViews,
        review: new ReviewOwner({
          checkpoints,
          userDataDir: app.getPath("userData"),
          resolveCheckoutPath: (checkoutId) => store.getWorkspacePath(checkoutId),
          validateTask: (target) =>
            store
              .snapshot()
              .workspaces.some(
                (workspace) =>
                  workspace.id === target.workspaceId &&
                  workspace.sessions.some((session) => session.id === target.sessionId),
              ),
        }),
        workspace: store,
        conversation: store,
        orchestration: store,
        scheduledTasks: store,
        settings: store,
        composerDraftFlush: composerDraftFlusher,
      },
      capabilities: {
        ping: () =>
          devReloadMarkersEnabled
            ? `pi desktop ready:${MAIN_DEV_RELOAD_MARKER}`
            : "pi desktop ready",
        theme: themeManager,
        setNativeDialogLocale: (window, locale) => {
          const changed = nativeLocaleFor(window) !== locale;
          nativeDialogLocales.set(window, locale);
          if (
            changed &&
            process.platform === "win32" &&
            window === (BrowserWindow.getFocusedWindow() ?? mainWindow)
          ) {
            installWindowsMenu(window);
          }
        },
        editors: editorService,
        openExternal: openExternalLink,
        pickWorkspace: (window) => pickWorkspaceViaDialog(window),
        createLoginCallbacks: (window) => createRuntimeLoginCallbacks(window),
        probeCustomProviderModels,
        notificationPermission: () => notificationPermissionService,
        terminal: getTerminalService,
        optionalTerminal: () => terminalService,
        setTerminalFocused: (webContentsId, focused) => {
          if (focused) {
            terminalFocusedWebContentsIds.add(webContentsId);
          } else {
            terminalFocusedWebContentsIds.delete(webContentsId);
          }
        },
        setSidePanelFocused: (webContentsId, focused) => {
          if (focused) {
            sidePanelFocusedWebContentsIds.add(webContentsId);
          } else {
            sidePanelFocusedWebContentsIds.delete(webContentsId);
          }
        },
        setTransparency: (enabled) => {
          if (process.platform !== "darwin") {
            return;
          }
          for (const window of windowOwner.allWindows()) {
            if (!window.isDestroyed()) {
              window.setVibrancy(enabled ? "under-window" : null);
            }
          }
        },
        pickComposerAttachments: async (window, existing = []) => {
          const parent = resolveDialogWindow(window);
          const options: OpenDialogOptions = {
            properties: ["openFile", "multiSelections"],
            title: dialogCopyFor(parent ?? undefined).attachFiles,
          };
          const result = parent
            ? await dialog.showOpenDialog(parent, options)
            : await dialog.showOpenDialog(options);
          if (result.canceled || result.filePaths.length === 0) {
            return undefined;
          }
          return readComposerAttachmentsFromPaths(result.filePaths, existing);
        },
        readClipboardImage: readClipboardImageAttachment,
        validateComposerAttachments: (attachments) =>
          attachments.flatMap(validateComposerAttachmentPayload),
        listWorkspaceFiles,
        readWorkspaceFile,
        revealWorkspaceFile: async (workspacePath, filePath) => {
          const resolved = await resolveExistingWorkspacePath(workspacePath, filePath);
          shell.showItemInFolder(resolved);
        },
        getChangedFiles,
        getFileDiff,
        stageFile,
        relaunchApplication: requestApplicationRelaunch,
      },
    });

    createAppWindow();
    void notificationPermissionService.getCurrentStatus().catch((error: unknown) => {
      console.error("[main] getCurrentStatus failed", error);
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createAppWindow();
        if (notificationPermissionService) {
          void notificationPermissionService.getCurrentStatus().catch((error: unknown) => {
            console.error("[main] getCurrentStatus failed", error);
          });
        }
      }
    });
  })
  .catch((error: unknown) => {
    console.error("[main] Application startup failed", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  // macOS normally keeps the app alive after its final window closes. The
  // Electron harness closes windows to end each isolated run, so let explicit
  // test-mode launches quit instead of leaving their process behind forever.
  if (process.platform !== "darwin" || appTestMode !== undefined) {
    stopNotifications?.();
    stopNotifications = undefined;
    notificationManager = undefined;
    notificationPermissionService?.dispose();
    notificationPermissionService = undefined;
    stopUpdateChecker?.();
    stopUpdateChecker = undefined;
    stopPruningTerminals?.();
    stopPruningTerminals = undefined;
    terminalService?.dispose();
    terminalService = undefined;
    app.quit();
  }
});

app.on("before-quit", (event) => {
  stopNotifications?.();
  stopNotifications = undefined;
  notificationManager = undefined;
  notificationPermissionService?.dispose();
  notificationPermissionService = undefined;
  stopUpdateChecker?.();
  stopUpdateChecker = undefined;
  stopPruningTerminals?.();
  stopPruningTerminals = undefined;
  terminalService?.dispose();
  terminalService = undefined;
  if (quitFlush === "done" || !store) {
    return;
  }

  event.preventDefault();
  // A second quit request during the flush waits for the one already running.
  if (quitFlush === "flushing") return;
  quitFlush = "flushing";
  const quittingStore = store;
  // Renderers send their debounced drafts first so the store flush below includes them.
  const flush = composerDraftFlusher
    .flush(windowOwner.allWindows())
    .then(() => Promise.all([quittingStore.flushPersistence(), extensionViewOwner?.dispose()]))
    .catch((error: unknown) => {
      console.error("pi-gui: persistence flush failed during quit:", error);
    });
  // Never let a hung flush block quit forever — quit after a bounded wait.
  const flushDeadline = new Promise<void>((resolve) => {
    setTimeout(() => {
      console.warn("pi-gui: persistence flush timed out during quit; quitting anyway.");
      resolve();
    }, QUIT_FLUSH_TIMEOUT_MS);
  });
  void Promise.race([Promise.all([flush, voiceInput?.dispose()]), flushDeadline])
    .finally(() => {
      quitFlush = "done";
      app.quit();
    })
    .catch((error: unknown) => {
      console.error("[main] Quit after persistence flush failed", error);
    });
});

function resolveInitialWorkspacePaths(): readonly string[] {
  const raw = process.env.PI_APP_INITIAL_WORKSPACES;
  if (raw !== undefined) {
    return raw
      .split(path.delimiter)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  return [];
}

async function readComposerAttachmentsFromPaths(
  filePaths: readonly string[],
  existing: readonly ComposerAttachment[] = [],
): Promise<ComposerAttachment[]> {
  const planned = filePaths.map((filePath) => ({
    filePath,
    mimeType: mimeTypeForPath(filePath),
  }));
  const imageSizes = await Promise.all(
    planned
      .filter((entry) => entry.mimeType.startsWith("image/"))
      .map(async (entry) => (await stat(entry.filePath)).size),
  );
  assertComposerImageFileSizes(imageSizes, existing);
  return Promise.all(planned.map((entry) => readComposerAttachment(entry.filePath)));
}

async function readComposerAttachment(filePath: string): Promise<ComposerAttachment> {
  const mimeType = mimeTypeForPath(filePath);
  if (mimeType.startsWith("image/")) {
    return readComposerImageAttachment(filePath, mimeType);
  }

  const stats = await stat(filePath);
  return {
    id: randomUUID(),
    kind: "file",
    name: path.basename(filePath),
    mimeType,
    fsPath: filePath,
    ...(typeof stats.size === "number" ? { sizeBytes: stats.size } : {}),
  };
}

async function readComposerImageAttachment(
  filePath: string,
  mimeType: string,
): Promise<ComposerImageAttachment> {
  const stats = await stat(filePath);
  assertComposerImageBytes(stats.size);
  const buffer = await readFile(filePath);
  assertComposerImageBytes(buffer.length);
  const image = nativeImage.createFromBuffer(buffer);
  if (!image.isEmpty()) {
    const size = image.getSize();
    assertComposerImagePixels(size.width, size.height);
  }
  return {
    id: randomUUID(),
    kind: "image",
    name: path.basename(filePath),
    mimeType,
    data: buffer.toString("base64"),
  };
}

function mimeTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).slice(1).toLowerCase();
  const supported = SUPPORTED_IMAGE_TYPES.find((type) => type.extension === extension);
  if (supported) {
    return supported.mimeType;
  }
  return "application/octet-stream";
}

function validateComposerAttachmentPayload(attachment: ComposerAttachment): ComposerAttachment[] {
  if (attachment.kind === "image") {
    if (
      typeof attachment.data !== "string" ||
      typeof attachment.mimeType !== "string" ||
      !SUPPORTED_IMAGE_MIME_TYPES.has(attachment.mimeType)
    ) {
      return [];
    }
    return [
      {
        ...attachment,
        kind: "image",
      },
    ];
  }

  if (
    attachment.kind !== "file" ||
    typeof attachment.fsPath !== "string" ||
    typeof attachment.mimeType !== "string" ||
    typeof attachment.name !== "string"
  ) {
    return [];
  }

  const normalized: ComposerFileAttachment = {
    ...attachment,
    kind: "file",
    fsPath: attachment.fsPath.trim(),
    name: attachment.name.trim() || path.basename(attachment.fsPath),
  };
  if (!normalized.fsPath) {
    return [];
  }
  return [normalized];
}

function createRuntimeLoginCallbacks(window?: BrowserWindow | null) {
  return {
    onAuth: async ({
      url,
      instructions,
    }: {
      readonly url: string;
      readonly instructions?: string;
    }) => {
      await shell.openExternal(url);
      if (instructions?.trim()) {
        await showLoginInstructions(window, instructions.trim());
      }
    },
    onPrompt: async ({
      message,
      placeholder,
      allowEmpty,
    }: {
      readonly message: string;
      readonly placeholder?: string;
      readonly allowEmpty?: boolean;
    }) => promptForText(window, message, placeholder, allowEmpty ?? false),
  };
}

async function showLoginInstructions(
  parentWindow: BrowserWindow | null | undefined,
  message: string,
): Promise<void> {
  const window = resolveDialogWindow(parentWindow);
  if (!window) {
    throw new Error("Main window is not available for login instructions.");
  }
  window.show();
  window.focus();
  await window.webContents.executeJavaScript(`window.alert(${JSON.stringify(message)})`, true);
}

// Electron does not implement window.prompt(), so provider-login text prompts
// are served by a small dedicated modal window instead.
async function promptForText(
  parentWindow: BrowserWindow | null | undefined,
  message: string,
  placeholder = "",
  allowEmpty = false,
): Promise<string> {
  const parent = resolveDialogWindow(parentWindow);
  if (!parent) {
    throw new Error("Main window is not available for login.");
  }
  parent.show();
  parent.focus();

  const modal = new BrowserWindow({
    parent,
    modal: true,
    show: false,
    width: 460,
    height: 220,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    autoHideMenuBar: process.platform !== "darwin",
    title: "pi-gui",
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });

  try {
    await modal.loadURL(promptDataUrl(message, placeholder));
    modal.show();
    modal.focus();

    const result = await new Promise<string | null>((resolve) => {
      let settled = false;
      const finish = (value: string | null) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      // Closing the window (title-bar close) counts as a cancel.
      modal.once("closed", () => finish(null));
      // The page wires its own buttons on load and exposes the outcome as a
      // promise; awaiting it here avoids any handler-attachment race.
      modal.webContents
        .executeJavaScript("window.__piPromptResult", true)
        .then((value) => finish(typeof value === "string" ? value : null))
        .catch(() => finish(null));
    });

    if (result === null) {
      throw new Error("Login cancelled.");
    }
    const trimmedResult = result.trim();
    if (!allowEmpty && trimmedResult.length === 0) {
      throw new Error("Login cancelled.");
    }
    return trimmedResult;
  } finally {
    if (!modal.isDestroyed()) {
      modal.destroy();
    }
  }
}

function promptDataUrl(message: string, placeholder: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 18px 20px; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #f4f5f7; color: #1b1d22; display: flex; flex-direction: column; gap: 14px; height: 100vh; }
  @media (prefers-color-scheme: dark) { body { background: #23262d; color: #e7e9ee; } input { background: #171a1f; color: #e7e9ee; border-color: #3a3f4a; } }
  .msg { line-height: 1.4; white-space: pre-wrap; }
  input { width: 100%; padding: 8px 10px; font-size: 13px; border: 1px solid #c3c8d0; border-radius: 6px;
    background: #fff; color: inherit; }
  input:focus { outline: 2px solid #4a8cff; outline-offset: 0; border-color: #4a8cff; }
  .row { margin-top: auto; display: flex; justify-content: flex-end; gap: 8px; }
  button { padding: 6px 16px; font-size: 13px; border-radius: 6px; border: 1px solid transparent; cursor: pointer; }
  #pi-prompt-cancel { background: transparent; border-color: #b7bdc7; color: inherit; }
  #pi-prompt-ok { background: #2f6ae0; color: #fff; }
</style></head>
<body>
  <div class="msg">${escapeHtml(message)}</div>
  <input id="pi-prompt-input" type="text" placeholder="${escapeHtml(placeholder)}" autofocus />
  <div class="row">
    <button id="pi-prompt-cancel" type="button">Cancel</button>
    <button id="pi-prompt-ok" type="button">OK</button>
  </div>
  <script>
    (function () {
      var resolveResult;
      window.__piPromptResult = new Promise(function (resolve) { resolveResult = resolve; });
      function wire() {
        var input = document.getElementById('pi-prompt-input');
        var ok = document.getElementById('pi-prompt-ok');
        var cancel = document.getElementById('pi-prompt-cancel');
        if (!input || !ok || !cancel) { resolveResult(null); return; }
        ok.addEventListener('click', function () { resolveResult(input.value); });
        cancel.addEventListener('click', function () { resolveResult(null); });
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') { event.preventDefault(); resolveResult(input.value); }
          else if (event.key === 'Escape') { event.preventDefault(); resolveResult(null); }
        });
        input.focus();
        document.body.dataset.piReady = '1';
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wire);
      } else {
        wire();
      }
    })();
  </script>
</body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function probeCustomProviderModels(
  input: CustomProviderProbeInput,
): Promise<CustomProviderProbeResult> {
  const baseUrl = input.baseUrl?.trim();
  if (!baseUrl || !isValidHttpBaseUrl(baseUrl)) {
    return { ok: false, error: "invalidUrl" };
  }
  const target = `${baseUrl.replace(/\/+$/, "")}/models`;
  const apiKey = input.apiKey?.trim();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  try {
    const url = new URL(target);
    if (url.username || url.password) {
      return { ok: false, error: "probeFailed" };
    }
    const request = net.request({
      method: "GET",
      url: url.href,
      redirect: "manual",
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
    });
    const response = await new Promise<IncomingMessage | null>((resolve, reject) => {
      request.once("redirect", () => {
        request.abort();
        resolve(null);
      });
      request.once("response", resolve);
      request.on("error", reject);
      timer = setTimeout(() => {
        timedOut = true;
        request.abort();
        reject(new Error("Model detection timed out"));
      }, 5000);
      request.end();
    });
    if (response === null) {
      return { ok: false, error: "probeRedirect" };
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      request.abort();
      return { ok: false, error: "probeHttpError", status: response.statusCode };
    }
    // Electron's IncomingMessage is a Node Readable at runtime.
    const payload: unknown = await readStreamJson(response as unknown as Readable);
    const data = (payload as { data?: unknown } | null)?.data;
    if (!Array.isArray(data)) {
      return { ok: false, error: "probeInvalidResponse" };
    }
    const models = data
      .map((entry) => {
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { id?: unknown }).id === "string"
        ) {
          return (entry as { id: string }).id;
        }
        return undefined;
      })
      .filter((id): id is string => Boolean(id && id.length > 0));
    return { ok: true, models };
  } catch (error) {
    if (timedOut) {
      return { ok: false, error: "probeTimeout" };
    }
    return {
      ok: false,
      error: error instanceof SyntaxError ? "probeInvalidResponse" : "probeFailed",
    };
  } finally {
    clearTimeout(timer);
  }
}
