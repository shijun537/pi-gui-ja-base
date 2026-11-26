import { isVoiceLanguage, type VoiceLanguage } from "../../contracts/voice-input";

export const voiceLanguageStorageKey = "pi-gui.voice-language";
let unsavedLanguage: VoiceLanguage | undefined;

export function readVoiceLanguage(): VoiceLanguage {
  if (unsavedLanguage) return unsavedLanguage;
  try {
    const saved = localStorage.getItem(voiceLanguageStorageKey);
    return isVoiceLanguage(saved) ? saved : "auto";
  } catch {
    return "auto";
  }
}

export function writeVoiceLanguage(language: VoiceLanguage): void {
  try {
    localStorage.setItem(voiceLanguageStorageKey, language);
    unsavedLanguage = undefined;
  } catch {
    unsavedLanguage = language;
  }
}
