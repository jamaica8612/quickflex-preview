const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_WORKS = 10_000;
const MAX_EXPENSES = 20_000;
const MAX_ROWS_PER_WORK = 200;

export const MAX_COMMERCIAL_RANGE_DAYS = 1096;

const WEEKDAYS = Object.freeze([
  Object.freeze({ weekday: 0, label: "일" }),
  Object.freeze({ weekday: 1, label: "월" }),
  Object.freeze({ weekday: 2, label: "화" }),
  Object.freeze({ weekday: 3, label: "수" }),
  Object.freeze({ weekday: 4, label: "목" }),
  Object.freeze({ weekday: 5, label: "금" }),
  Object.freeze({ weekday: 6, label: "토" }),
]);

function pad2(value) {
  return String(value).padStart(2, "0");
}

function dateKeyFromUtc(date) {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function normalizeDateKey(value) {
  if (typeof value !== "string") return null;
  const match = DATE_KEY_RE.exec(value);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const key = dateKeyFromUtc(date);
  return key === value ? key : null;
}

function parseDateKey(value) {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const match = DATE_KEY_RE.exec(key);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addDays(value, days) {
  const date = parseDateKey(value);
  if (!date || !Number.isInteger(days)) return null;
  return dateKeyFromUtc(new Date(date.getTime() + days * DAY_MS));
}

function dayCount(start, end) {
  const from = parseDateKey(start);
  const to = parseDateKey(end);
  if (!from || !to || from > to) return 0;
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS) + 1;
}

function rangeInput(value, label = "기간") {
  const start = normalizeDateKey(value?.start ?? value?.from);
  const end = normalizeDateKey(value?.end ?? value?.to);
  const days = dayCount(start, end);
  if (!start || !end || !days) throw new RangeError(`${label}의 시작일과 종료일을 확인해 주세요.`);
  if (days > MAX_COMMERCIAL_RANGE_DAYS) {
    throw new RangeError(`${label}은 최대 ${MAX_COMMERCIAL_RANGE_DAYS}일까지 조회할 수 있습니다.`);
  }
  return Object.freeze({ start, end, days });
}

function filtersInput(filters = {}) {
  const range = rangeInput(filters);
  const asOfDate = normalizeDateKey(filters.asOfDate ?? range.end);
  if (!asOfDate) throw new RangeError("기준일을 확인해 주세요.");
  const shift = filters.shift == null || filters.shift === "all" ? null : filters.shift;
  if (shift !== null && shift !== "day" && shift !== "night") {
    throw new RangeError("근무조는 day 또는 night여야 합니다.");
  }
  const route = filters.route == null || filters.route === "all" ? null : String(filters.route).trim();
  if (route !== null && !route) throw new RangeError("구역 필터를 확인해 주세요.");
  return { ...range, asOfDate, shift, route };
}

function boundedArray(value, max, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label}은 배열이어야 합니다.`);
  if (value.length > max) throw new RangeError(`${label}은 최대 ${max}개까지 처리할 수 있습니다.`);
  return value;
}

function isNonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeMoney(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function addMoney(total, amount) {
  const result = total + amount;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("금액 합계가 안전하게 계산할 수 있는 범위를 넘었습니다.");
  }
  return result;
}

function validateRow(row) {
  return row && typeof row === "object"
    && typeof row.route === "string" && row.route.trim().length > 0
    && isNonNegativeNumber(row.settlementCount)
    && (row.normalItems === null || isNonNegativeNumber(row.normalItems))
    && isNonNegativeMoney(row.amount)
    && isNonNegativeMoney(row.unit)
    && typeof row.source === "string" && row.source.trim().length > 0;
}

function validateWork(work) {
  if (!work || typeof work !== "object") return "invalid_work";
  if (!normalizeDateKey(work.workDate)) return "invalid_work_date";
  if (work.shift !== "day" && work.shift !== "night") return "invalid_shift";
  if (!["confirmed", "planned", "in-progress", "off"].includes(work.status)) return "invalid_status";
  if (!isNonNegativeMoney(work.amount)
    || !isNonNegativeMoney(work.freshAmount)
    || !isNonNegativeMoney(work.allowanceAmount)) return "invalid_amount";
  if (!Array.isArray(work.rows) || work.rows.length > MAX_ROWS_PER_WORK || !work.rows.every(validateRow)) {
    return "invalid_rows";
  }
  if (work.measurement !== null) {
    const measurement = work.measurement;
    if (!measurement || typeof measurement !== "object"
      || !isNonNegativeNumber(measurement.completedHouseholds)
      || !isNonNegativeNumber(measurement.completedItems)
      || !isNonNegativeNumber(measurement.activeSeconds)) return "invalid_measurement";
  }
  return null;
}

function selectionAmount(work, route) {
  return route === null
    ? work.amount
    : work.rows.reduce((sum, row) => addMoney(sum, row.amount), 0);
}

function latestWorks(works) {
  const groups = new Map();
  const diagnostics = {
    inputCount: works.length,
    selectedCount: 0,
    rejectedCount: 0,
    rejected: [],
  };
  works.forEach((work, index) => {
    const id = typeof work?.id === "string" ? work.id.trim() : "";
    const revision = work?.revision;
    if (!id || !Number.isInteger(revision) || revision < 0) {
      diagnostics.rejected.push({ id: id || null, index, reason: "invalid_identity" });
      return;
    }
    const group = groups.get(id) ?? [];
    group.push({ work, index });
    groups.set(id, group);
  });

  const selected = [];
  for (const [id, group] of groups) {
    const latestRevision = Math.max(...group.map(({ work }) => work.revision));
    const latest = group.filter(({ work }) => work.revision === latestRevision);
    if (latest.length !== 1) {
      diagnostics.rejected.push({ id, revision: latestRevision, reason: "ambiguous_latest_revision" });
      continue;
    }
    const [{ work, index }] = latest;
    const reason = validateWork(work);
    if (reason) {
      diagnostics.rejected.push({ id, revision: latestRevision, index, reason });
      continue;
    }
    selected.push(work);
  }
  diagnostics.rejectedCount = diagnostics.rejected.length;
  return { selected, diagnostics };
}

/**
 * Returns the 26th-through-25th settlement cycle named by its ending month.
 */
export function settlementRange(yearValue, monthValue) {
  const year = Number(typeof yearValue === "object" ? yearValue?.year : yearValue);
  const month = Number(typeof yearValue === "object" ? yearValue?.month : monthValue);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError("정산월은 올바른 연도와 1~12월로 지정해야 합니다.");
  }
  const endMonth = new Date(Date.UTC(year, month - 1, 1));
  const startMonth = new Date(Date.UTC(year, month - 2, 1));
  return Object.freeze({
    id: `${year}-${pad2(month)}`,
    start: `${startMonth.getUTCFullYear()}-${pad2(startMonth.getUTCMonth() + 1)}-26`,
    end: `${endMonth.getUTCFullYear()}-${pad2(endMonth.getUTCMonth() + 1)}-25`,
  });
}

/**
 * Selects one unambiguous latest revision per id, then applies confirmed/date/route/shift filters.
 */
export function selectConfirmedWorks(worksInput, filters = {}) {
  const works = boundedArray(worksInput, MAX_WORKS, "업무 기록");
  const normalized = filtersInput(filters);
  const { selected, diagnostics } = latestWorks(works);
  const result = [];
  for (const work of selected) {
    if (work.status !== "confirmed") continue;
    if (work.workDate < normalized.start || work.workDate > normalized.end || work.workDate > normalized.asOfDate) {
      continue;
    }
    if (normalized.shift && work.shift !== normalized.shift) continue;
    const rows = normalized.route
      ? work.rows.filter((row) => row.route === normalized.route)
      : work.rows.slice();
    if (normalized.route && rows.length === 0) continue;
    result.push({ ...work, rows });
  }
  result.sort((left, right) => left.workDate.localeCompare(right.workDate)
    || left.shift.localeCompare(right.shift) || left.id.localeCompare(right.id));
  diagnostics.selectedCount = result.length;
  return { works: result, diagnostics, filters: normalized };
}

function summarizeWorkdays(works, route) {
  const dayAmounts = new Map();
  const shiftComposition = { day: 0, night: 0 };
  let settlementCount = 0;
  for (const work of works) {
    dayAmounts.set(work.workDate, addMoney(dayAmounts.get(work.workDate) ?? 0, selectionAmount(work, route)));
    shiftComposition[work.shift] += 1;
    settlementCount += work.rows.reduce((sum, row) => sum + row.settlementCount, 0);
  }
  const days = [...dayAmounts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([workDate, amount], index) => ({ workDate, ordinal: index + 1, amount }));
  const amount = days.reduce((sum, day) => addMoney(sum, day.amount), 0);
  return {
    amount,
    settlementCount,
    workDays: days.length,
    workSessions: works.length,
    averageAmountPerWorkday: days.length ? amount / days.length : null,
    shiftComposition,
    days,
  };
}

function precedingRange(range) {
  const end = addDays(range.start, -1);
  return rangeInput({ start: addDays(end, -(range.days - 1)), end }, "이전 기간");
}

function comparisonPrecedingRange(range) {
  const endDate = parseDateKey(range.end);
  const possibleSettlement = settlementRange(endDate.getUTCFullYear(), endDate.getUTCMonth() + 1);
  if (range.start === possibleSettlement.start && range.end === possibleSettlement.end) {
    const previousMonth = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth() - 1, 1));
    return rangeInput(settlementRange(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1), "이전 기간");
  }
  const startDate = parseDateKey(range.start);
  const monthEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1, 0));
  if (startDate.getUTCDate() === 1 && range.end === dateKeyFromUtc(monthEnd)) {
    const previousMonthEnd = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 0));
    return rangeInput({
      start: `${previousMonthEnd.getUTCFullYear()}-${pad2(previousMonthEnd.getUTCMonth() + 1)}-01`,
      end: dateKeyFromUtc(previousMonthEnd),
    }, "이전 기간");
  }
  return precedingRange(range);
}

function deltaRate(current, previous) {
  return previous === 0 ? null : (current - previous) / Math.abs(previous);
}

/** Compares current distinct workdays with the first equal number from the previous range. */
export function compareSameWorkdays(works, options = {}) {
  const currentRange = rangeInput(options.range ?? options, "현재 기간");
  const previousRange = options.previousRange
    ? rangeInput(options.previousRange, "이전 기간")
    : comparisonPrecedingRange(currentRange);
  const common = { route: options.route, shift: options.shift };
  const currentSelection = selectConfirmedWorks(works, {
    ...currentRange,
    ...common,
    asOfDate: options.asOfDate ?? currentRange.end,
  });
  const previousSelection = selectConfirmedWorks(works, {
    ...previousRange,
    ...common,
    asOfDate: previousRange.end,
  });
  const current = summarizeWorkdays(currentSelection.works, currentSelection.filters.route);
  const previousAll = summarizeWorkdays(previousSelection.works, previousSelection.filters.route);
  const base = {
    available: false,
    reason: null,
    requiredWorkDays: current.workDays,
    availablePreviousWorkDays: previousAll.workDays,
    current,
    previous: null,
    amountDelta: null,
    amountDeltaRate: null,
    matchedPreviousThrough: null,
    currentRange,
    previousRange,
  };
  if (current.workDays === 0) return { ...base, reason: "current_no_workdays" };
  if (previousAll.workDays < current.workDays) {
    return { ...base, reason: "previous_insufficient_workdays" };
  }
  const matchedDates = new Set(previousAll.days.slice(0, current.workDays).map((day) => day.workDate));
  const matchedWorks = previousSelection.works.filter((work) => matchedDates.has(work.workDate));
  const previous = summarizeWorkdays(matchedWorks, previousSelection.filters.route);
  return {
    ...base,
    available: true,
    current,
    previous,
    amountDelta: current.amount - previous.amount,
    amountDeltaRate: deltaRate(current.amount, previous.amount),
    matchedPreviousThrough: previous.days.at(-1)?.workDate ?? null,
  };
}

/** Weekday normal-item averages use distinct valid work dates as their own denominators. */
export function weekdayNormalDeliveryStats(works, filters = {}) {
  const selection = selectConfirmedWorks(works, filters);
  const byWeekday = new Map(WEEKDAYS.map(({ weekday, label }) => [weekday, {
    weekday,
    label,
    normalItems: 0,
    dates: new Set(),
    revenueAmount: 0,
    revenueDates: new Set(),
  }]));
  let excludedUnknownRows = 0;
  const excludedUnknownDates = new Set();
  for (const work of selection.works) {
    const weekday = parseDateKey(work.workDate).getUTCDay();
    const group = byWeekday.get(weekday);
    group.revenueAmount = addMoney(group.revenueAmount, selectionAmount(work, selection.filters.route));
    group.revenueDates.add(work.workDate);
    let hasKnown = false;
    for (const row of work.rows) {
      if (row.normalItems === null) {
        excludedUnknownRows += 1;
        excludedUnknownDates.add(work.workDate);
        continue;
      }
      hasKnown = true;
      group.normalItems += row.normalItems;
      group.dates.add(work.workDate);
    }
    if (hasKnown) excludedUnknownDates.delete(work.workDate);
  }
  const minimumSamplesForRanking = Number.isInteger(filters.minimumSamplesForRanking)
    && filters.minimumSamplesForRanking > 0 ? filters.minimumSamplesForRanking : 2;
  const weekdays = WEEKDAYS.map(({ weekday }) => {
    const group = byWeekday.get(weekday);
    const workDays = group.dates.size;
    const revenueWorkDays = group.revenueDates.size;
    return {
      weekday: group.weekday,
      label: group.label,
      normalItems: group.normalItems,
      workDays,
      averageNormalItems: workDays ? group.normalItems / workDays : null,
      revenueAmount: group.revenueAmount,
      revenueWorkDays,
      averageRevenuePerWorkday: revenueWorkDays ? group.revenueAmount / revenueWorkDays : null,
      rankEligible: workDays >= minimumSamplesForRanking,
    };
  });
  const eligible = weekdays.filter((row) => row.rankEligible)
    .sort((left, right) => right.averageNormalItems - left.averageNormalItems || left.weekday - right.weekday);
  return {
    weekdays,
    bestWeekday: eligible[0] ?? null,
    minimumSamplesForRanking,
    excludedUnknownRows,
    excludedUnknownWorkDays: excludedUnknownDates.size,
    diagnostics: selection.diagnostics,
  };
}

/**
 * Adds an overlapping holiday subset without removing those dates from their weekdays.
 * Holiday metadata belongs to the caller so this pure preview module has no network source.
 */
export function holidayNormalDeliveryStats(works, { holidayDates = [], ...filters } = {}) {
  boundedArray(holidayDates, MAX_COMMERCIAL_RANGE_DAYS, "공휴일 날짜");
  const normalizedHolidayDates = new Set();
  const invalidHolidayDates = [];
  holidayDates.forEach((value) => {
    const dateKey = normalizeDateKey(value);
    if (dateKey) normalizedHolidayDates.add(dateKey);
    else invalidHolidayDates.push(value);
  });
  const base = weekdayNormalDeliveryStats(works, filters);
  const selection = selectConfirmedWorks(works, filters);
  let normalItems = 0;
  let excludedUnknownRows = 0;
  const knownDates = new Set();
  const unknownOnlyDates = new Set();
  for (const work of selection.works) {
    if (!normalizedHolidayDates.has(work.workDate)) continue;
    let hasKnown = false;
    for (const row of work.rows) {
      if (row.normalItems === null) {
        excludedUnknownRows += 1;
        unknownOnlyDates.add(work.workDate);
        continue;
      }
      hasKnown = true;
      normalItems += row.normalItems;
      knownDates.add(work.workDate);
    }
    if (hasKnown) unknownOnlyDates.delete(work.workDate);
  }
  const dates = [...knownDates].sort();
  const workDays = dates.length;
  return {
    ...base,
    holiday: {
      normalItems,
      workDays,
      sampleWorkDays: workDays,
      averageNormalItems: workDays ? normalItems / workDays : null,
      dates,
      excludedUnknownRows,
      excludedUnknownWorkDays: unknownOnlyDates.size,
    },
    invalidHolidayDates,
  };
}

function makeGroup(key, extra = {}) {
  return {
    key,
    ...extra,
    amount: 0,
    settlementCount: 0,
    normalItems: 0,
    normalKnown: false,
    workDates: new Set(),
    normalDates: new Set(),
    workIds: new Set(),
  };
}

function addRowToGroup(group, work, row) {
  group.amount = addMoney(group.amount, row.amount);
  group.settlementCount += row.settlementCount;
  group.workDates.add(work.workDate);
  group.workIds.add(work.id);
  if (row.normalItems !== null) {
    group.normalItems += row.normalItems;
    group.normalKnown = true;
    group.normalDates.add(work.workDate);
  }
}

function finalizeGroup(group) {
  const workDays = group.workDates.size;
  const normalSampleWorkDays = group.normalDates.size;
  const normalItems = group.normalKnown ? group.normalItems : null;
  const { workDates, normalDates, workIds, normalKnown, ...plain } = group;
  return {
    ...plain,
    normalItems,
    workDays,
    workSessions: workIds.size,
    normalSampleWorkDays,
    averageAmountPerWorkday: workDays ? group.amount / workDays : null,
    averageNormalItemsPerWorkday: normalSampleWorkDays ? group.normalItems / normalSampleWorkDays : null,
  };
}

/** Keeps stored grouped route labels intact; it never clones or divides a row among routes. */
export function routeShiftStats(works, filters = {}) {
  const selection = selectConfirmedWorks(works, filters);
  const routeGroups = new Map();
  const shiftGroups = new Map();
  const matrixGroups = new Map();
  const overall = makeGroup("overall");
  for (const work of selection.works) {
    let workNormalItems = 0;
    let workNormalKnown = false;
    for (const row of work.rows) {
      const route = row.route;
      const routeGroup = routeGroups.get(route) ?? makeGroup(route, {
        route,
        grouped: route.includes("|"),
      });
      addRowToGroup(routeGroup, work, row);
      routeGroups.set(route, routeGroup);

      const matrixKey = `${route}\u0000${work.shift}`;
      const matrixGroup = matrixGroups.get(matrixKey) ?? makeGroup(matrixKey, {
        route,
        shift: work.shift,
        grouped: route.includes("|"),
      });
      addRowToGroup(matrixGroup, work, row);
      matrixGroups.set(matrixKey, matrixGroup);

      overall.settlementCount += row.settlementCount;
      if (row.normalItems !== null) {
        workNormalItems += row.normalItems;
        workNormalKnown = true;
      }
    }
    overall.amount = addMoney(overall.amount, selectionAmount(work, selection.filters.route));
    overall.workDates.add(work.workDate);
    overall.workIds.add(work.id);
    if (workNormalKnown) {
      overall.normalItems += workNormalItems;
      overall.normalKnown = true;
      overall.normalDates.add(work.workDate);
    }

    const shiftGroup = shiftGroups.get(work.shift) ?? makeGroup(work.shift, { shift: work.shift });
    shiftGroup.amount = addMoney(shiftGroup.amount, selectionAmount(work, selection.filters.route));
    shiftGroup.workDates.add(work.workDate);
    shiftGroup.workIds.add(work.id);
    shiftGroup.settlementCount += work.rows.reduce((sum, row) => sum + row.settlementCount, 0);
    if (workNormalKnown) {
      shiftGroup.normalItems += workNormalItems;
      shiftGroup.normalKnown = true;
      shiftGroup.normalDates.add(work.workDate);
    }
    shiftGroups.set(work.shift, shiftGroup);
  }
  const sortRoute = (left, right) => left.route.localeCompare(right.route, "ko");
  return {
    overall: finalizeGroup(overall),
    byRoute: [...routeGroups.values()].map(finalizeGroup).sort(sortRoute),
    byShift: [...shiftGroups.values()].map(finalizeGroup).sort((a, b) => a.shift.localeCompare(b.shift)),
    byRouteShift: [...matrixGroups.values()].map(finalizeGroup)
      .sort((left, right) => sortRoute(left, right) || left.shift.localeCompare(right.shift)),
    diagnostics: selection.diagnostics,
  };
}

function normalizeExpenses(expensesInput) {
  const expenses = boundedArray(expensesInput, MAX_EXPENSES, "지출 기록");
  const ids = new Map();
  expenses.forEach((expense, index) => {
    const id = typeof expense?.id === "string" ? expense.id.trim() : "";
    const rows = ids.get(id) ?? [];
    rows.push({ expense, index });
    ids.set(id, rows);
  });
  const valid = [];
  const rejected = [];
  for (const [id, entries] of ids) {
    if (!id) {
      rejected.push(...entries.map(({ index }) => ({ id: null, index, reason: "invalid_identity" })));
      continue;
    }
    if (entries.length !== 1) {
      rejected.push({ id, reason: "duplicate_identity" });
      continue;
    }
    const [{ expense, index }] = entries;
    if (!normalizeDateKey(expense.date)
      || !isNonNegativeMoney(expense.amount)
      || typeof expense.category !== "string" || !expense.category.trim()
      || (expense.liters !== undefined && !isNonNegativeNumber(expense.liters))
      || (expense.kwh !== undefined && !isNonNegativeNumber(expense.kwh))
      || (expense.workId !== undefined && (typeof expense.workId !== "string" || !expense.workId.trim()))) {
      rejected.push({ id, index, reason: "invalid_expense" });
      continue;
    }
    valid.push(expense);
  }
  return { valid, diagnostics: { inputCount: expenses.length, rejectedCount: rejected.length, rejected } };
}

function summarizeExpenses(expenses, range, asOfDate, workIds) {
  const selected = expenses.filter((expense) => expense.date >= range.start
    && expense.date <= range.end && expense.date <= asOfDate
    && (!workIds || (expense.workId && workIds.has(expense.workId))));
  const categories = new Map();
  let amount = 0;
  let literAmount = 0;
  let liters = 0;
  let kwhAmount = 0;
  let kwh = 0;
  for (const expense of selected) {
    amount = addMoney(amount, expense.amount);
    categories.set(expense.category, addMoney(categories.get(expense.category) ?? 0, expense.amount));
    if (typeof expense.liters === "number" && expense.liters > 0) {
      literAmount = addMoney(literAmount, expense.amount);
      liters += expense.liters;
    }
    if (typeof expense.kwh === "number" && expense.kwh > 0) {
      kwhAmount = addMoney(kwhAmount, expense.amount);
      kwh += expense.kwh;
    }
  }
  return {
    amount,
    count: selected.length,
    categories: [...categories.entries()].sort(([left], [right]) => left.localeCompare(right, "ko"))
      .map(([category, categoryAmount]) => ({
        category,
        amount: categoryAmount,
        share: amount === 0 ? null : categoryAmount / amount,
      })),
    unitCosts: {
      wonPerLiter: liters > 0 ? literAmount / liters : null,
      wonPerKwh: kwh > 0 ? kwhAmount / kwh : null,
      liters: liters > 0 ? liters : null,
      kwh: kwh > 0 ? kwh : null,
    },
  };
}

/** Summarizes actual expense dates and compares the immediately previous equal-length range. */
export function expenseStats(expenses, options = {}) {
  const requestedRange = rangeInput(options.range ?? options, "현재 기간");
  const asOfDate = normalizeDateKey(options.asOfDate ?? requestedRange.end);
  if (!asOfDate) throw new RangeError("기준일을 확인해 주세요.");
  const effectiveEnd = asOfDate >= requestedRange.start && asOfDate < requestedRange.end
    ? asOfDate
    : requestedRange.end;
  const range = rangeInput({ start: requestedRange.start, end: effectiveEnd }, "현재 기간");
  const previousBoundary = options.previousRange
    ? rangeInput(options.previousRange, "이전 기간")
    : precedingRange(range);
  const previousRange = options.previousRange
    ? rangeInput({
      start: previousBoundary.start,
      end: addDays(previousBoundary.start, range.days - 1),
    }, "이전 기간")
    : previousBoundary;
  if (previousRange.end > previousBoundary.end) throw new RangeError("지출 비교 기간은 같은 일수여야 합니다.");
  const normalized = normalizeExpenses(expenses);
  const current = summarizeExpenses(normalized.valid, range, asOfDate, options.workIds ?? null);
  const previous = summarizeExpenses(normalized.valid, previousRange, previousRange.end, options.previousWorkIds ?? null);
  return {
    range,
    previousRange,
    current,
    previous,
    amountDelta: current.amount - previous.amount,
    amountDeltaRate: deltaRate(current.amount, previous.amount),
    diagnostics: normalized.diagnostics,
  };
}

/** Aggregates measurement pace by totals divided by total active time. */
export function measurementStats(works, filters = {}) {
  const route = filters.route == null || filters.route === "all" ? null : String(filters.route).trim();
  if (route !== null && !route) throw new RangeError("구역 필터를 확인해 주세요.");
  const selection = selectConfirmedWorks(works, { ...filters, route: null });
  const measurements = [];
  const deviceIds = new Set();
  let missingMeasurements = 0;
  let unknownDeviceMeasurements = 0;
  let excludedAmbiguousRouteMeasurements = 0;
  for (const work of selection.works) {
    if (route) {
      const routes = new Set(work.rows.map((row) => row.route));
      if (!routes.has(route)) continue;
      if (routes.size !== 1 || [...routes][0].includes("|")) {
        excludedAmbiguousRouteMeasurements += 1;
        continue;
      }
    }
    if (work.measurement === null) {
      missingMeasurements += 1;
      continue;
    }
    const deviceId = typeof work.measurement.deviceId === "string" ? work.measurement.deviceId.trim() : "";
    if (!deviceId) {
      unknownDeviceMeasurements += 1;
      continue;
    }
    deviceIds.add(deviceId);
    measurements.push(work.measurement);
  }
  const listedDeviceIds = [...deviceIds].sort();
  const unavailable = (reason) => ({
    available: false,
    reason,
    deviceIds: listedDeviceIds,
    sampleCount: 0,
    completedHouseholds: null,
    completedItems: null,
    activeSeconds: null,
    householdsPerHour: null,
    itemsPerHour: null,
    missingMeasurements,
    unknownDeviceMeasurements,
    excludedAmbiguousRouteMeasurements,
    diagnostics: selection.diagnostics,
  });
  if (listedDeviceIds.length > 1) return unavailable("multiple_devices");
  if (measurements.length === 0) {
    return unavailable(unknownDeviceMeasurements ? "unknown_device" : "no_measurements");
  }
  const totals = measurements.reduce((result, measurement) => ({
    completedHouseholds: result.completedHouseholds + measurement.completedHouseholds,
    completedItems: result.completedItems + measurement.completedItems,
    activeSeconds: result.activeSeconds + measurement.activeSeconds,
  }), { completedHouseholds: 0, completedItems: 0, activeSeconds: 0 });
  return {
    available: true,
    reason: null,
    deviceIds: listedDeviceIds,
    sampleCount: measurements.length,
    ...totals,
    householdsPerHour: totals.activeSeconds > 0
      ? totals.completedHouseholds * 3600 / totals.activeSeconds : null,
    itemsPerHour: totals.activeSeconds > 0
      ? totals.completedItems * 3600 / totals.activeSeconds : null,
    missingMeasurements,
    unknownDeviceMeasurements,
    excludedAmbiguousRouteMeasurements,
    diagnostics: selection.diagnostics,
  };
}

/** Builds the complete pure preview metric model from already-priced ledger values. */
export function buildCommercialMetrics({
  works = [],
  expenses = [],
  range,
  previousRange,
  asOfDate,
  route,
  shift,
} = {}) {
  const normalizedRange = rangeInput(range, "현재 기간");
  const filters = { ...normalizedRange, asOfDate: asOfDate ?? normalizedRange.end, route, shift };
  const selection = selectConfirmedWorks(works, filters);
  const comparison = compareSameWorkdays(works, {
    range: normalizedRange,
    previousRange,
    asOfDate,
    route,
    shift,
  });
  const selectedWorkIds = new Set(selection.works.map((work) => work.id));
  const resolvedPreviousRange = comparison.previousRange;
  const previousWorkIds = new Set(selectConfirmedWorks(works, {
    ...resolvedPreviousRange,
    asOfDate: resolvedPreviousRange.end,
    route,
    shift,
  }).works.map((work) => work.id));
  return {
    range: normalizedRange,
    filters: selection.filters,
    summary: summarizeWorkdays(selection.works, selection.filters.route),
    comparison,
    weekdayNormalDeliveries: weekdayNormalDeliveryStats(works, filters),
    routeShift: routeShiftStats(works, filters),
    expenses: expenseStats(expenses, {
      range: normalizedRange,
      previousRange,
      asOfDate,
      workIds: route || shift ? selectedWorkIds : null,
      previousWorkIds: route || shift ? previousWorkIds : null,
    }),
    measurement: measurementStats(works, filters),
    diagnostics: { works: selection.diagnostics },
  };
}
