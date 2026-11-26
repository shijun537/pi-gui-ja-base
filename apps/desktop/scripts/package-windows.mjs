import { runElectronBuilder } from "./run-electron-builder.mjs";
import { buildWhisperWindows } from "./build-whisper-windows.mjs";

const electronBuilderArgs = process.argv.slice(2);
if (electronBuilderArgs.length === 0) {
  throw new Error("Usage: package-windows.mjs <electron-builder args...>");
}

await buildWhisperWindows();
process.exit(await runElectronBuilder(electronBuilderArgs));
