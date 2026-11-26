import type { NativeDialogLocale } from "../../contracts/ipc";

export const nativeDialogCopy = {
  en: {
    openFolder: "Open workspace folder",
    attachFiles: "Attach files",
    mcpLinkTitle: "Open this MCP sign-in link yourself",
    localLinkOnly: "pi-gui opens only https links, or http links on this computer.",
    browserUnavailable: "pi-gui could not open your browser.",
    checkLink: "Check the link before you open it:",
    copyLink: "Copy link",
    close: "Close",
    agentFinished: "Agent finished responding",
    agentNeedsInput: "Needs your input",
    warning: "Warning",
    error: "Error",
  },
  ja: {
    openFolder: "作業フォルダを開く",
    attachFiles: "添付するファイルを選ぶ",
    mcpLinkTitle: "MCP のログインリンクをブラウザーで開いてください",
    localLinkOnly:
      "pi-gui が開けるのは HTTPS のリンクと、このコンピューター宛ての HTTP リンクです。",
    browserUnavailable: "ブラウザーを開けませんでした。",
    checkLink: "開く前にリンク先を確認してください。",
    copyLink: "リンクをコピー",
    close: "閉じる",
    agentFinished: "AI の応答が完了しました",
    agentNeedsInput: "入力を待っています",
    warning: "警告",
    error: "エラー",
  },
} satisfies Record<NativeDialogLocale, Record<string, string>>;

export type NativeCopy = (typeof nativeDialogCopy)[NativeDialogLocale];
