import { voiceRecordingSeconds, voiceSampleRate } from "../../../contracts/voice-input";

export async function captureVoice(
  signal: AbortSignal,
  onRecording: (stop: () => void) => void,
): Promise<Uint8Array> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
  const release = () => stream.getTracks().forEach((track) => track.stop());
  try {
    signal.throwIfAborted();
    const recorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
    const stop = () => {
      if (recorder.state !== "inactive") recorder.stop();
      release();
    };
    const recording = new Promise<Blob>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => resolve(event.data), { once: true });
      recorder.addEventListener("error", () => reject(new Error("Recording failed.")), {
        once: true,
      });
    });
    signal.addEventListener("abort", stop, { once: true });
    const limit = window.setTimeout(stop, voiceRecordingSeconds * 1000);
    let blob: Blob;
    try {
      recorder.start();
      onRecording(stop);
      blob = await recording;
      signal.throwIfAborted();
    } finally {
      window.clearTimeout(limit);
      signal.removeEventListener("abort", stop);
      stop();
    }
    if (blob.size === 0) return new Uint8Array();
    const decoder = new OfflineAudioContext(1, 1, voiceSampleRate);
    const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.min(audio.length, voiceRecordingSeconds * voiceSampleRate);
    const pcm = new DataView(new ArrayBuffer(frames * 2));
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const samples = audio.getChannelData(channel);
      for (let frame = 0; frame < frames; frame++) {
        const sample = Math.max(-1, Math.min(1, samples[frame] ?? 0)) / audio.numberOfChannels;
        pcm.setInt16(frame * 2, pcm.getInt16(frame * 2, true) + sample * 32767, true);
      }
    }
    return new Uint8Array(pcm.buffer);
  } finally {
    release();
  }
}
