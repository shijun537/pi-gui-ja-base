import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n";

export function useRunningLabel(startedAt: string | undefined) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!startedAt) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  const started = startedAt ? Date.parse(startedAt) : NaN;
  if (Number.isNaN(started)) return t("conversation.working");
  const seconds = Math.max(1, Math.floor((now - started) / 1000));
  if (seconds < 60) return t("conversation.workingSeconds", { seconds });
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return remaining === 0
    ? t("conversation.workingMinutes", { minutes })
    : t("conversation.workingDuration", { minutes, seconds: remaining });
}
