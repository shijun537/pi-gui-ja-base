import type { ScheduledTaskRecord } from "../../../contracts/desktop-state";
import { useTranslation } from "../../i18n";
import { formatScheduleMeta } from "./scheduled-task-copy";

interface ScheduledTaskChipProps {
  readonly task: ScheduledTaskRecord;
  readonly onOpen: () => void;
}

export function ScheduledTaskChip({ task, onOpen }: ScheduledTaskChipProps) {
  const { locale, t } = useTranslation();
  return (
    <div className="scheduled-task-chip" data-testid="scheduled-task-chip">
      <span>{formatScheduleMeta(task, locale, t)}</span>
      <button className="button button--secondary" type="button" onClick={onOpen}>
        {t("schedule.open")}
      </button>
    </div>
  );
}
