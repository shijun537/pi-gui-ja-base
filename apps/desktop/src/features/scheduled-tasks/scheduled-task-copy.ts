import type { ScheduledTaskRecord, ScheduledTaskSchedule } from "../../../contracts/desktop-state";
import {
  formatScheduledTaskRecurrence,
  formatScheduledTaskRowMeta,
  WEEKDAY_NAMES,
  type Weekday,
} from "../../../contracts/scheduled-tasks";
import type { AppLocale } from "../../i18n/catalog";
import type { Translate } from "../../i18n/translate";

const japaneseWeekday = new Intl.DateTimeFormat("ja", { weekday: "short", timeZone: "UTC" });
const japaneseDateTime = new Intl.DateTimeFormat("ja", {
  dateStyle: "medium",
  timeStyle: "short",
  hourCycle: "h23",
});

export function localizedWeekday(day: Weekday, locale: AppLocale): string {
  return locale === "ja"
    ? japaneseWeekday.format(new Date(Date.UTC(2024, 0, 7 + day)))
    : WEEKDAY_NAMES[day].slice(0, 3);
}

export function formatScheduleRecurrence(
  schedule: ScheduledTaskSchedule,
  locale: AppLocale,
  t: Translate,
): string {
  if (locale !== "ja") return formatScheduledTaskRecurrence(schedule);
  if (schedule.kind === "once") {
    const timestamp = Date.parse(schedule.at);
    return Number.isNaN(timestamp)
      ? t("schedule.once")
      : t("schedule.recurrence.once", { time: japaneseDateTime.format(timestamp) });
  }
  if (schedule.kind === "interval") {
    const minutes = Math.round(schedule.everyMs / 60_000);
    if (minutes % 1440 === 0)
      return t("schedule.recurrence.intervalDays", { count: minutes / 1440 });
    if (minutes % 60 === 0) return t("schedule.recurrence.intervalHours", { count: minutes / 60 });
    return t("schedule.recurrence.intervalMins", { count: minutes });
  }
  const time = `${String(schedule.hour).padStart(2, "0")}:${String(schedule.minute).padStart(2, "0")}`;
  if (schedule.kind === "daily") return t("schedule.recurrence.daily", { time });
  const days = [...schedule.days]
    .sort((a, b) => a - b)
    .map((day) => localizedWeekday(day, locale))
    .join("・");
  return t("schedule.recurrence.weekly", { days, time });
}

export function formatScheduleMeta(
  task: ScheduledTaskRecord,
  locale: AppLocale,
  t: Translate,
): string {
  if (locale !== "ja") return formatScheduledTaskRowMeta(task);
  const recurrence = formatScheduleRecurrence(task.schedule, locale, t);
  if (task.status === "completed") return recurrence;
  if (task.status === "paused") return `${recurrence} · ${t("schedule.filter.paused")}`;
  const timestamp = task.nextRunAt ? Date.parse(task.nextRunAt) : NaN;
  if (Number.isNaN(timestamp)) return recurrence;
  const remaining = timestamp - Date.now();
  const minutes = Math.floor(remaining / 60_000);
  let next: string;
  if (remaining <= 0) next = t("schedule.due");
  else if (minutes < 1) next = t("schedule.nextSoon");
  else if (minutes < 60) next = t("schedule.nextMinutes", { count: minutes });
  else if (minutes < 1440) next = t("schedule.nextHours", { count: Math.floor(minutes / 60) });
  else next = t("schedule.nextDays", { count: Math.floor(minutes / 1440) });
  return `${recurrence} · ${next}`;
}
