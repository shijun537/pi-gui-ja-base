import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { voiceModelBytes } from "../../../contracts/voice-input";
import { useTranslation } from "../../i18n";
import type { MessageKey } from "../../i18n/messages/en";
import { readVoiceLanguage } from "../../lib/voice-language";
import { MicrophoneIcon, StopSquareIcon } from "../../ui/icons";
import { captureVoice } from "./voice-recording";

type VoicePhase = "idle" | "checking" | "setup" | "download" | "starting" | "recording" | "working";

export function ComposerVoiceInput({
  composerRef,
  onInsert,
  footer,
}: {
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly onInsert: (text: string, submit: boolean) => void;
  readonly footer: (control?: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const api = window.piApp;
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [notice, setNotice] = useState<MessageKey>();
  const [progress, setProgress] = useState(0);
  const [canCancelDownload, setCanCancelDownload] = useState(false);
  const operation = useRef<AbortController | undefined>(undefined);
  const downloadCancelled = useRef(false);
  const stopRecording = useRef<(() => void) | undefined>(undefined);
  const stoppedWithEnter = useRef(false);
  const submitRecording = useRef(false);
  const insertText = useRef(onInsert);
  const stop = useCallback((submit: boolean) => {
    const stopCapture = stopRecording.current;
    if (!stopCapture) return;
    stopRecording.current = undefined;
    submitRecording.current = submit;
    stopCapture();
    setPhase("working");
  }, []);
  useLayoutEffect(() => {
    insertText.current = onInsert;
  });
  useLayoutEffect(() => () => operation.current?.abort(), []);

  useLayoutEffect(() => {
    const composer = composerRef.current;
    if (api?.platform !== "win32" || !composer) return;
    const busy = ["checking", "starting", "recording", "working"].includes(phase);
    const handleEnter = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
      if (!event.repeat) stoppedWithEnter.current = false;
      if (!busy && !stoppedWithEnter.current) return;
      event.preventDefault();
      event.stopPropagation();
      if (phase === "recording" && !event.repeat) {
        stoppedWithEnter.current = true;
        stop(true);
      }
    };
    composer.addEventListener("keydown", handleEnter, true);
    return () => composer.removeEventListener("keydown", handleEnter, true);
  }, [api, composerRef, phase, stop]);

  useEffect(() => {
    if (phase !== "download" || !api) return;
    let active = true;
    const timer = window.setInterval(() => {
      void api
        .voiceModelStatus()
        .then((status) => {
          if (!active) return;
          if (status.kind === "downloading") {
            setProgress(Math.floor((100 * status.received) / voiceModelBytes));
            setCanCancelDownload(status.canCancel);
          } else {
            setPhase(status.kind === "missing" ? "setup" : "idle");
            if (status.kind === "ready") setNotice("composer.voice.ready");
          }
        })
        .catch(() => {
          if (active) {
            setPhase("idle");
            setNotice("composer.voice.downloadFailed");
          }
        });
    }, 750);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, phase]);

  if (!api || api.platform !== "win32") return footer();

  const start = async () => {
    const language = readVoiceLanguage();
    submitRecording.current = false;
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    setNotice(undefined);
    setPhase("checking");
    try {
      const model = await api.voiceModelStatus();
      signal.throwIfAborted();
      if (model.kind !== "ready") {
        if (model.kind === "downloading") {
          setCanCancelDownload(model.canCancel);
          setProgress(Math.floor((100 * model.received) / voiceModelBytes));
          setPhase("download");
        } else if (model.kind === "missing") setPhase("setup");
        else {
          setNotice("composer.voice.unavailable");
          setPhase("idle");
        }
        return;
      }
      setPhase("starting");
      const pcm = await captureVoice(signal, (stopCapture) => {
        stopRecording.current = stopCapture;
        composerRef.current?.focus({ preventScroll: true });
        setPhase("recording");
      });
      signal.throwIfAborted();
      setPhase("working");
      const cancel = () => {
        void api.cancelVoiceTranscription().catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = pcm.length > 0 ? await api.transcribeVoice(pcm, language) : "";
        signal.throwIfAborted();
        if (result) insertText.current(result, submitRecording.current);
        else setNotice("composer.voice.empty");
      } finally {
        signal.removeEventListener("abort", cancel);
      }
      setPhase("idle");
    } catch (error) {
      if (signal.aborted) return;
      const denied = error instanceof DOMException && error.name === "NotAllowedError";
      setNotice(denied ? "composer.voice.permission" : "composer.voice.failed");
      setPhase("idle");
    } finally {
      if (operation.current === controller) {
        operation.current = undefined;
        stopRecording.current = undefined;
      }
    }
  };
  const download = () => {
    downloadCancelled.current = false;
    setNotice(undefined);
    setProgress(0);
    setCanCancelDownload(true);
    setPhase("download");
    void api.downloadVoiceModel().catch(() => {
      setPhase("setup");
      if (!downloadCancelled.current) setNotice("composer.voice.downloadFailed");
    });
  };
  const cancel = () => {
    if (phase === "download" && canCancelDownload) {
      downloadCancelled.current = true;
      void api.cancelVoiceDownload().catch(() => undefined);
      return;
    }
    operation.current?.abort();
    stopRecording.current = undefined;
    setNotice(undefined);
    setPhase("idle");
  };
  const recording = phase === "recording";
  const label = t(recording ? "composer.voice.stop" : "composer.voice.start");
  const status =
    phase === "setup"
      ? t("composer.voice.setup")
      : phase === "download"
        ? t("composer.voice.downloading", { percent: progress })
        : phase === "checking"
          ? t("composer.voice.checking")
          : phase === "starting"
            ? t("composer.voice.starting")
            : phase === "recording"
              ? t("composer.voice.recording")
              : phase === "working"
                ? t("composer.voice.working")
                : undefined;

  return (
    <>
      {status || notice ? (
        <div className="composer-voice">
          <div role="status">
            {notice ? t(notice) : null}
            {notice && status ? " " : null}
            {status}
          </div>
          {phase === "setup" ? (
            <button className="button button--primary" type="button" onClick={download}>
              {t("composer.voice.download")}
            </button>
          ) : null}
          {phase !== "idle" ? (
            <button className="button button--ghost" type="button" onClick={cancel}>
              {t(
                phase === "download" && !canCancelDownload
                  ? "composer.voice.close"
                  : "composer.voice.cancel",
              )}
            </button>
          ) : null}
        </div>
      ) : null}
      {footer(
        <button
          aria-keyshortcuts={recording ? "Enter" : undefined}
          aria-label={label}
          className="icon-button composer__attach"
          type="button"
          title={label}
          disabled={!recording && phase !== "idle"}
          onClick={() => {
            if (recording) {
              stop(false);
            } else {
              void start().catch(() => undefined);
            }
          }}
        >
          {recording ? <StopSquareIcon /> : <MicrophoneIcon />}
        </button>,
      )}
    </>
  );
}
