import { addDays, toDateKey } from "./date.js";

const NIGHT_NEXT_WORK_DATE_HOUR = 12;

/** Night work started before noon still belongs to the current calendar date. */
export function measurementWorkDateForClock(now, workShift) {
  const currentDate = toDateKey(now);
  return workShift === "night" && now.getHours() >= NIGHT_NEXT_WORK_DATE_HOUR
    ? addDays(currentDate, 1)
    : currentDate;
}
