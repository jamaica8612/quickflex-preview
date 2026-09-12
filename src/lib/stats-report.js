const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_CUSTOM_RANGE_DAYS = 1096;

const MODE_ALIASES = Object.freeze({
  thisSettlement: "thisSettlement",
  thisMonth: "thisSettlement",
  settlement: "thisSettlement",
  current: "thisSettlement",
  lastSettlement: "lastSettlement",
  lastMonth: "lastSettlement",
  previous: "lastSettlement",
  last3: "last3",
  last12: "last12",
  custom: "custom",
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function dateKeyFromParts(year, month, day) {
  return dateKeyFromUtcDate(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Normalizes a local calendar Date or a strict YYYY-MM-DD string.
 * Strings that roll over (for example 2026-02-30) are rejected.
 */
export function normalizeDateKey(value) {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) return null;
    const isUtcMidnight = value.getUTCHours() === 0
      && value.getUTCMinutes() === 0
      && value.getUTCSeconds() === 0
      && value.getUTCMilliseconds() === 0;
    const year = isUtcMidnight ? value.getUTCFullYear() : value.getFullYear();
    const month = (isUtcMidnight ? value.getUTCMonth() : value.getMonth()) + 1;
    const day = isUtcMidnight ? value.getUTCDate() : value.getDate();
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  if (typeof value !== "string") return null;
  const match = DATE_KEY_RE.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const candidate = dateKeyFromParts(year, month, day);
  return candidate === `${match[1]}-${match[2]}-${match[3]}` ? candidate : null;
}

/** Returns a UTC-midnight Date so date arithmetic is unaffected by DST. */
export function parseDateKey(value) {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const match = DATE_KEY_RE.exec(key);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  if (!date || !Number.isInteger(amount)) return null;
  return dateKeyFromUtcDate(new Date(date.getTime() + amount * DAY_MS));
}

export function dateKeysBetween(startValue, endValue) {
  const start = parseDateKey(startValue);
  const end = parseDateKey(endValue);
  if (!start || !end || start > end) return [];
  const keys = [];
  for (let time = start.getTime(); time <= end.getTime(); time += DAY_MS) {
    keys.push(dateKeyFromUtcDate(new Date(time)));
  }
  return keys;
}

export function dateRangeDayCount(startValue, endValue) {
  const start = parseDateKey(startValue);
  const end = parseDateKey(endValue);
  if (!start || !end || start > end) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function normalizePeriodInput(yearOrPeriod, monthValue) {
  const year = typeof yearOrPeriod === "object" && yearOrPeriod !== null
    ? Number(yearOrPeriod.year)
    : Number(yearOrPeriod);
  const month = typeof yearOrPeriod === "object" && yearOrPeriod !== null
    ? Number(yearOrPeriod.month)
    : Number(monthValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("정산주기는 올바른 연도와 1~12월로 지정해야 합니다.");
  }
  return { year, month };
}

/** A settlement month runs from the previous calendar month's 26th through its 25th. */
export function settlementPeriod(yearOrPeriod, monthValue) {
  const { year, month } = normalizePeriodInput(yearOrPeriod, monthValue);
  return Object.freeze({
    id: `${year}-${pad2(month)}`,
    year,
    month,
    start: dateKeyFromParts(year, month - 1, 26),
    end: dateKeyFromParts(year, month, 25),
  });
}

export function shiftSettlementPeriod(yearOrPeriod, amount) {
  const { year, month } = normalizePeriodInput(yearOrPeriod);
  if (!Number.isInteger(amount)) throw new TypeError("정산주기 이동값은 정수여야 합니다.");
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1));
  return settlementPeriod(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1);
}

export function settlementPeriodsEndingAt(yearOrPeriod, count) {
  const period = settlementPeriod(yearOrPeriod);
  if (!Number.isInteger(count) || count < 1) throw new RangeError("정산주기 개수는 1 이상이어야 합니다.");
  return Array.from({ length: count }, (_, index) => shiftSettlementPeriod(period, index - count + 1));
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function sourceRows(source) {
  if (Array.isArray(source)) return source;
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([dateKey, value]) => ({
    ...(value && typeof value === "object" ? value : {}),
    dateKey,
  }));
}

/**
 * Converts already-calculated daily app values into one row per date.
 * Multiple rows for a date are summed, which also permits line-item callers.
 */
export function normalizeStatsDays(source) {
  const byDate = new Map();
  let ignoredRecordCount = 0;
  sourceRows(source).forEach((input) => {
    const dateKey = normalizeDateKey(input?.dateKey ?? input?.date);
    if (!dateKey) {
      ignoredRecordCount += 1;
      return;
    }
    const revenue = finiteNumber(input.revenue);
    const count = finiteNumber(input.count ?? input.deliveryCount);
    const freshCount = finiteNumber(input.freshCount);
    const off = input.off === true || input.isOff === true;
    const explicitWorked = typeof input.worked === "boolean"
      ? input.worked
      : (typeof input.isWorked === "boolean" ? input.isWorked : null);
    const worked = !off && (explicitWorked ?? (revenue !== 0 || count > 0));
    const previous = byDate.get(dateKey);
    if (!previous) {
      byDate.set(dateKey, {
        dateKey,
        revenue,
        count,
        freshCount,
        worked,
        off,
        hasRecord: true,
      });
      return;
    }
    previous.revenue += revenue;
    previous.count += count;
    previous.freshCount += freshCount;
    previous.worked = previous.worked || worked;
    previous.off = previous.off && off;
  });
  return {
    days: [...byDate.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey)),
    ignoredRecordCount,
  };
}

function daysInRange(days, start, end) {
  return days.filter((day) => day.dateKey >= start && day.dateKey <= end);
}

function summarizeDays(days) {
  const summary = days.reduce((result, day) => {
    result.revenue += day.revenue;
    result.count += day.count;
    result.freshCount += day.freshCount;
    result.workDays += day.worked ? 1 : 0;
    result.offDays += day.off ? 1 : 0;
    result.recordDays += day.hasRecord ? 1 : 0;
    return result;
  }, { revenue: 0, count: 0, freshCount: 0, workDays: 0, offDays: 0, recordDays: 0 });
  return {
    ...summary,
    averageRevenue: summary.workDays ? summary.revenue / summary.workDays : 0,
    averageCount: summary.workDays ? summary.count / summary.workDays : 0,
  };
}

function deltaRate(current, previous) {
  if (previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

/**
 * Compares all current worked days with the first equal number of worked days
 * from the previous settlement. Partial previous data never becomes a comparison.
 */
export function buildEqualWorkdayComparison(days, currentPeriodInput, { asOfDate } = {}) {
  const currentPeriod = settlementPeriod(currentPeriodInput);
  const previousPeriod = shiftSettlementPeriod(currentPeriod, -1);
  const asOfKey = normalizeDateKey(asOfDate);
  const currentEnd = asOfKey && asOfKey >= currentPeriod.start && asOfKey < currentPeriod.end
    ? asOfKey
    : currentPeriod.end;
  const currentWorked = daysInRange(days, currentPeriod.start, currentEnd).filter((day) => day.worked);
  const previousWorked = daysInRange(days, previousPeriod.start, previousPeriod.end).filter((day) => day.worked);
  const requiredWorkDays = currentWorked.length;
  const base = {
    available: false,
    reason: null,
    requiredWorkDays,
    availablePreviousWorkDays: previousWorked.length,
    current: summarizeDays(currentWorked),
    previous: null,
    revenueDelta: null,
    revenueDeltaRate: null,
    countDelta: null,
    countDeltaRate: null,
  };
  if (!requiredWorkDays) return { ...base, reason: "current_no_workdays" };
  if (previousWorked.length < requiredWorkDays) {
    return { ...base, reason: "previous_insufficient_workdays" };
  }
  const matchedPrevious = previousWorked.slice(0, requiredWorkDays);
  const previous = summarizeDays(matchedPrevious);
  const current = base.current;
  return {
    ...base,
    available: true,
    current,
    previous,
    matchedPreviousThrough: matchedPrevious.at(-1)?.dateKey || null,
    revenueDelta: current.revenue - previous.revenue,
    revenueDeltaRate: deltaRate(current.revenue, previous.revenue),
    countDelta: current.count - previous.count,
    countDeltaRate: deltaRate(current.count, previous.count),
  };
}

function normalizeMode(value) {
  const mode = MODE_ALIASES[value || "thisSettlement"];
  if (!mode) throw new RangeError(`지원하지 않는 통계 기간입니다: ${value}`);
  return mode;
}

function normalizeCustomRange(customRange) {
  const start = normalizeDateKey(customRange?.from ?? customRange?.start);
  const end = normalizeDateKey(customRange?.to ?? customRange?.end);
  if (!start || !end || start > end) {
    throw new RangeError("직접 조회 기간의 시작일과 종료일을 확인해 주세요.");
  }
  if (dateRangeDayCount(start, end) > MAX_CUSTOM_RANGE_DAYS) {
    throw new RangeError(`직접 조회 기간은 최대 ${MAX_CUSTOM_RANGE_DAYS}일까지 선택할 수 있습니다.`);
  }
  return { start, end, periods: [] };
}

function rangeForMode(currentPeriod, mode, asOfDate, customRange) {
  if (mode === "custom") return normalizeCustomRange(customRange);
  const asOfKey = normalizeDateKey(asOfDate);
  const clampCurrentEnd = (period) => (
    asOfKey && asOfKey >= period.start && asOfKey < period.end ? asOfKey : period.end
  );
  if (mode === "lastSettlement") {
    const previous = shiftSettlementPeriod(currentPeriod, -1);
    return { start: previous.start, end: previous.end, periods: [previous] };
  }
  const periodCount = mode === "last3" ? 3 : (mode === "last12" ? 12 : 1);
  const periods = settlementPeriodsEndingAt(currentPeriod, periodCount);
  return {
    start: periods[0].start,
    end: clampCurrentEnd(currentPeriod),
    periods,
  };
}

function shortDate(dateKey) {
  const match = DATE_KEY_RE.exec(dateKey);
  return `${Number(match[2])}.${Number(match[3])}`;
}

function bucketSummary(key, label, start, end, days) {
  return { key, label, start, end, ...summarizeDays(daysInRange(days, start, end)) };
}

function mondayFor(dateKey) {
  const date = parseDateKey(dateKey);
  const distance = (date.getUTCDay() + 6) % 7;
  return addDays(dateKey, -distance);
}

function buildDailyBuckets(days, range) {
  return dateKeysBetween(range.start, range.end).map((dateKey) => (
    bucketSummary(dateKey, shortDate(dateKey), dateKey, dateKey, days)
  ));
}

function buildWeeklyBuckets(days, range) {
  const buckets = [];
  for (let weekStart = mondayFor(range.start); weekStart <= range.end; weekStart = addDays(weekStart, 7)) {
    const start = weekStart < range.start ? range.start : weekStart;
    const weekEnd = addDays(weekStart, 6);
    const end = weekEnd > range.end ? range.end : weekEnd;
    buckets.push(bucketSummary(weekStart, `${shortDate(start)}~${shortDate(end)}`, start, end, days));
  }
  return buckets;
}

function buildSettlementBuckets(days, range) {
  return range.periods.map((period) => {
    const end = period.end > range.end ? range.end : period.end;
    return bucketSummary(period.id, `${period.year}년 ${period.month}월`, period.start, end, days);
  });
}

export function isSeriesEmpty(buckets) {
  return !buckets.some((bucket) => bucket.revenue !== 0 || bucket.count !== 0);
}

export function buildTrend(days, currentPeriodInput, modeInput, { asOfDate, customRange } = {}) {
  const currentPeriod = settlementPeriod(currentPeriodInput);
  const mode = normalizeMode(modeInput);
  const range = rangeForMode(currentPeriod, mode, asOfDate, customRange);
  const customDayCount = mode === "custom" ? dateRangeDayCount(range.start, range.end) : 0;
  const granularity = mode === "last3" || (mode === "custom" && customDayCount > 62)
    ? "week"
    : (mode === "last12" ? "settlement" : "day");
  const buckets = granularity === "week"
    ? buildWeeklyBuckets(days, range)
    : (granularity === "settlement" ? buildSettlementBuckets(days, range) : buildDailyBuckets(days, range));
  return {
    granularity,
    isEmpty: isSeriesEmpty(buckets),
    buckets,
  };
}

/**
 * Builds the UI-facing statistics report from daily, already-priced values.
 * Callers may provide `dailyRecords`, `days`, or an object keyed by date as `entries`.
 */
export function buildStatsReport({
  dailyRecords,
  days: inputDays,
  entries,
  currentPeriod,
  mode = "thisSettlement",
  asOfDate,
  customRange,
  goal,
} = {}) {
  const period = settlementPeriod(currentPeriod);
  const normalizedMode = normalizeMode(mode);
  const normalized = normalizeStatsDays(dailyRecords ?? inputDays ?? entries ?? []);
  const range = rangeForMode(period, normalizedMode, asOfDate, customRange);
  const selectedDays = daysInRange(normalized.days, range.start, range.end);
  const summary = summarizeDays(selectedDays);
  const trend = buildTrend(normalized.days, period, normalizedMode, { asOfDate, customRange });
  const comparison = buildEqualWorkdayComparison(normalized.days, period, { asOfDate });
  const target = finiteNumber(goal) > 0 ? finiteNumber(goal) : null;
  const applicable = normalizedMode === "thisSettlement" || normalizedMode === "lastSettlement";
  const progressPct = applicable && target ? (summary.revenue / target) * 100 : null;
  return {
    mode: normalizedMode,
    period,
    range: {
      start: range.start,
      end: range.end,
      settlementCount: range.periods.length,
    },
    summary,
    comparison,
    trend,
    empty: trend.isEmpty,
    goal: {
      applicable,
      target: applicable ? target : null,
      progressPct,
      cappedProgressPct: progressPct === null ? null : Math.min(100, Math.max(0, progressPct)),
    },
    ignoredRecordCount: normalized.ignoredRecordCount,
  };
}
