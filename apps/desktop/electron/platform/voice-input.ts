import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { availableParallelism } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  voiceModelBytes,
  voiceSampleRate,
  type VoiceLanguage,
  type VoiceModelStatus,
} from "../../contracts/voice-input";

const modelName = "ggml-large-v3.bin";
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861/${modelName}`;
const modelHash = "64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2";

interface VoiceDownload {
  readonly owner: number;
  readonly abort: AbortController;
  received: number;
  readonly done: Promise<void>;
}

function wavHeader(bytes: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(bytes + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(voiceSampleRate, 24);
  header.writeUInt32LE(voiceSampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  return header;
}

export class VoiceInput {
  private readonly modelPath: string;
  private verifiedModel?: { size: number; mtimeMs: number; ctimeMs: number };
  private verification?: Promise<boolean>;
  private download?: VoiceDownload;
  private readonly transcriptions = new Map<
    number,
    { readonly abort: AbortController; readonly done: Promise<string> }
  >();
  private disposed = false;
  private accelerationFailed = false;

  constructor(
    private readonly executable: string | undefined,
    userData: string,
  ) {
    this.modelPath = path.join(userData, "voice-input", modelName);
  }

  async status(owner: number): Promise<VoiceModelStatus> {
    if (!this.executable || !(await stat(this.executable).catch(() => null))?.isFile()) {
      return { kind: "unavailable" };
    }
    if (this.download) {
      return {
        kind: "downloading",
        received: this.download.received,
        canCancel: this.download.owner === owner,
      };
    }
    return { kind: (await this.hasModel()) ? "ready" : "missing" };
  }

  private hasModel(): Promise<boolean> {
    this.verification ??= this.verifyModel().finally(() => {
      this.verification = undefined;
    });
    return this.verification;
  }

  private async verifyModel(): Promise<boolean> {
    const file = await stat(this.modelPath).catch(() => null);
    if (!file?.isFile() || file.size !== voiceModelBytes) return false;
    const verified = this.verifiedModel;
    if (
      verified?.size === file.size &&
      verified.mtimeMs === file.mtimeMs &&
      verified.ctimeMs === file.ctimeMs
    ) {
      return true;
    }
    const hash = createHash("sha256");
    try {
      for await (const chunk of createReadStream(this.modelPath)) hash.update(chunk as Buffer);
    } catch {
      return false;
    }
    if (hash.digest("hex") !== modelHash) return false;
    this.verifiedModel = file;
    return true;
  }

  install(owner: number): Promise<void> {
    if (this.disposed) return Promise.reject(new Error("Voice input is shutting down."));
    if (this.download) return this.download.done;
    const abort = new AbortController();
    const transfer: VoiceDownload = {
      owner,
      abort,
      received: 0,
      done: this.downloadModel((received) => {
        transfer.received = received;
      }, abort.signal).finally(() => {
        this.download = undefined;
      }),
    };
    this.download = transfer;
    return transfer.done;
  }

  private async downloadModel(
    progress: (received: number) => void,
    cancelled: AbortSignal,
  ): Promise<void> {
    if (!this.executable || !(await stat(this.executable).catch(() => null))?.isFile()) {
      throw new Error("Voice input is unavailable.");
    }
    if (await this.hasModel()) return;
    const signal = AbortSignal.any([cancelled, AbortSignal.timeout(2 * 60 * 60 * 1000)]);
    const directory = path.dirname(this.modelPath);
    await mkdir(directory, { recursive: true });
    const partial = `${this.modelPath}.partial`;
    try {
      // Only the app's single running instance owns this staging path.
      await rm(partial, { force: true });
      const response = await fetch(modelUrl, { signal });
      if (!response.ok || !response.body) throw new Error("Voice model download failed.");
      const hash = createHash("sha256");
      let received = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length;
          if (received > voiceModelBytes) {
            callback(new Error("Unexpected voice model size."));
            return;
          }
          hash.update(chunk);
          progress(received);
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        createWriteStream(partial, { flags: "wx" }),
        {
          signal,
        },
      );
      if (received !== voiceModelBytes || hash.digest("hex") !== modelHash) {
        throw new Error("Voice model verification failed.");
      }
      signal.throwIfAborted();
      await rename(partial, this.modelPath);
      this.verifiedModel = await stat(this.modelPath);
    } finally {
      await rm(partial, { force: true });
    }
  }

  cancelDownload(owner?: number): void {
    if (owner === undefined || this.download?.owner === owner) this.download?.abort.abort();
  }

  async transcribe(owner: number, pcm: Uint8Array, language: VoiceLanguage): Promise<string> {
    const executable = this.executable;
    if (!executable || this.disposed || this.transcriptions.has(owner)) {
      throw new Error("Voice input is unavailable or busy.");
    }
    const abort = new AbortController();
    // large-v3 can use several gigabytes per process. Keep recordings from other
    // windows queued in memory while the previous recognition finishes.
    const pending = Promise.allSettled([...this.transcriptions.values()].map((job) => job.done));
    const turn = new Promise<void>((resolve, reject) => {
      const cancel = () => reject(new Error("Voice transcription was cancelled."));
      abort.signal.addEventListener("abort", cancel, { once: true });
      void pending.then(() => {
        abort.signal.removeEventListener("abort", cancel);
        resolve();
      }, reject);
    });
    const done = turn
      .then(() => this.runTranscription(executable, pcm, language, abort.signal))
      .finally(() => this.transcriptions.delete(owner));
    this.transcriptions.set(owner, { abort, done });
    return done;
  }

  private async runTranscription(
    executable: string,
    pcm: Uint8Array,
    language: VoiceLanguage,
    signal: AbortSignal,
  ): Promise<string> {
    if (!(await this.hasModel())) throw new Error("Voice model is missing.");
    const vulkan = path.join(path.dirname(executable), "whisper-vulkan.exe");
    const systemRoot = process.env.SystemRoot;
    if (
      !this.accelerationFailed &&
      systemRoot &&
      (await stat(vulkan).catch(() => null))?.isFile() &&
      (await stat(path.join(systemRoot, "System32", "vulkan-1.dll")).catch(() => null))?.isFile()
    ) {
      try {
        return await this.runWhisper(vulkan, pcm, language, signal, true);
      } catch {
        signal.throwIfAborted();
        this.accelerationFailed = true;
      }
    }
    return this.runWhisper(executable, pcm, language, signal, false);
  }

  private runWhisper(
    executable: string,
    pcm: Uint8Array,
    language: VoiceLanguage,
    signal: AbortSignal,
    accelerated: boolean,
  ): Promise<string> {
    signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const failed = () => reject(new Error("Voice transcription failed."));
      const child = execFile(
        executable,
        [
          "-m",
          this.modelPath,
          "-f",
          "-",
          // A stdin input defaults its output name to "-", which disables the CLI's
          // normal sentence output. An explicit name keeps stdout enabled without a file.
          "-of",
          "transcript",
          "-l",
          language,
          ...(accelerated ? [] : ["-ng", "-np"]),
          "-nt",
          "-t",
          String(Math.min(6, availableParallelism())),
        ],
        {
          cwd: path.dirname(executable),
          windowsHide: true,
          // The first Vulkan run can also spend time preparing GPU pipelines.
          timeout: accelerated ? 60_000 : 120_000,
        },
        (error, stdout) => {
          signal.removeEventListener("abort", stop);
          if (error || signal.aborted) failed();
          else resolve(stdout.trim());
        },
      );
      const stop = () => child.kill();
      signal.addEventListener("abort", stop, { once: true });
      if (accelerated && child.stderr) {
        // Upstream can continue on CPU after a failed Vulkan initialization.
        createInterface({ input: child.stderr }).on("line", (line) => {
          if (/^whisper_backend_init_gpu: (?:no GPU found|failed to initialize)/.test(line)) stop();
        });
      }
      child.stdin?.once("error", stop);
      child.stdin?.end(Buffer.concat([wavHeader(pcm.length), pcm]));
    });
  }

  cancelTranscription(owner: number): void {
    this.transcriptions.get(owner)?.abort.abort();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const pending: Promise<unknown>[] = [];
    if (this.download) pending.push(this.download.done);
    this.cancelDownload();
    for (const active of this.transcriptions.values()) {
      pending.push(active.done);
      active.abort.abort();
    }
    await Promise.allSettled(pending);
  }
}
