export const voiceSampleRate = 16_000;
export const voiceRecordingSeconds = 30;
export const voiceModelBytes = 3_095_033_483;

export type VoiceLanguage = "auto" | "ja";

export function isVoiceLanguage(value: unknown): value is VoiceLanguage {
  return value === "auto" || value === "ja";
}

export type VoiceModelStatus =
  | { readonly kind: "unavailable" | "missing" | "ready" }
  | { readonly kind: "downloading"; readonly received: number; readonly canCancel: boolean };
