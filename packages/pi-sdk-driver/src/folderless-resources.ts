import type { PiResourceLoaderOptions } from "./npm-package-fallback.js";

/** The text-only conversation uses configured models without loading project resources. */
export const folderlessResourceOptions = {
  noExtensions: true,
  noSkills: true,
  noPromptTemplates: true,
  noThemes: true,
  noContextFiles: true,
  systemPrompt:
    "You are a helpful assistant. Help the user with questions and writing. You do not have access to project files or a shell in this conversation.",
  appendSystemPrompt: [],
} satisfies PiResourceLoaderOptions;
