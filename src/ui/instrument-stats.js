const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
const ONE_DECIMAL_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const WEEKDAYS = Object.freeze([
  Object.freeze({ dayIndex: 1, label: "월" }),
  Object.freeze({ dayIndex: 2, label: "화" }),
  Object.freeze({ dayIndex: 3, label: "수" }),
  Object.freeze({ dayIndex: 4, label: "목" }),
  Object.freeze({ dayIndex: 5, label: "금" }),
  Object.freeze({ dayIndex: 6, label: "토" }),
  Object.freeze({ dayIndex: 0, label: "일" }),
]);

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function defaultFormatWon(value) {
  return `${NUMBER_FORMAT.format(Math.round(finiteNumber(value)))}원`;
}

function formatCount(value) {
  return `${NUMBER_FORMAT.format(Math.round(finiteNumber(value)))}개`;
}

function parseLocalDateKey(value) {
  const match = DATE_KEY_RE.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (
    utcDate.getUTCFullYear() !== year
    || utcDate.getUTCMonth() !== month - 1
    || utcDate.getUTCDate() !== day
  ) return null;
  return {
    dateKey: `${match[1]}-${match[2]}-${match[3]}`,
    weekday: utcDate.getUTCDay(),
  };
}

function formatDateKey(value) {
  const parsed = parseLocalDateKey(value);
  if (!parsed) return "";
  const [, year, month, day] = DATE_KEY_RE.exec(parsed.dateKey);
  return `${year}.${month}.${day}`;
}

function formatRange(range) {
  const start = formatDateKey(range?.start);
  const end = formatDateKey(range?.end);
  if (!start || !end) return "조회 기간 없음";
  return start === end ? start : `${start} – ${end}`;
}

function comparisonStatement(comparison, formatWon) {
  const rawRate = comparison?.revenueDeltaRate;
  const rate = typeof rawRate === "number" && Number.isFinite(rawRate) ? rawRate : null;
  const delta = finiteNumber(comparison?.revenueDelta);
  if (rate !== null) {
    const percent = ONE_DECIMAL_FORMAT.format(Math.abs(rate) * 100);
    if (rate > 0) {
      return { before: "지난 정산 같은 근무일 수보다 매출이 ", value: `${percent}%`, after: " 앞서 있습니다." };
    }
    if (rate < 0) {
      return { before: "지난 정산 같은 근무일 수보다 매출이 ", value: `${percent}%`, after: " 줄었습니다." };
    }
    return { before: "지난 정산 같은 근무일 수와 매출이 ", value: "같은 수준", after: "입니다." };
  }
  if (delta > 0) {
    return { before: "지난 정산 같은 근무일 수보다 매출이 ", value: String(formatWon(delta)), after: " 늘었습니다." };
  }
  if (delta < 0) {
    return { before: "지난 정산 같은 근무일 수보다 매출이 ", value: String(formatWon(Math.abs(delta))), after: " 줄었습니다." };
  }
  return { before: "지난 정산 같은 근무일 수와 매출이 ", value: "같은 수준", after: "입니다." };
}

function insufficientComparisonNote(comparison) {
  if (comparison?.reason === "previous_insufficient_workdays") {
    const required = Math.max(0, Math.round(finiteNumber(comparison.requiredWorkDays)));
    const available = Math.max(0, Math.round(finiteNumber(comparison.availablePreviousWorkDays)));
    return `이전 정산 근무 기록이 ${available}일뿐이라 현재 ${required}일과 아직 비교할 수 없습니다.`;
  }
  if (comparison?.reason === "current_no_workdays") {
    return "근무 기록이 쌓이면 이전 정산과 같은 근무일 수로 비교합니다.";
  }
  return "같은 근무일 수의 이전 정산 기록이 충분해지면 비교합니다.";
}

export function buildInstrumentInsightModel(report, { title = "이번 정산", formatWon = defaultFormatWon } = {}) {
  const summary = report?.summary ?? {};
  const revenue = finiteNumber(summary.revenue);
  const count = finiteNumber(summary.count);
  const workDays = Math.max(0, Math.round(finiteNumber(summary.workDays)));
  const rangeText = formatRange(report?.range);
  const wonFormatter = typeof formatWon === "function" ? formatWon : defaultFormatWon;
  const formattedRevenue = String(wonFormatter(revenue));
  const canCompare = report?.mode === "thisSettlement" && report?.comparison?.available === true;
  let statement;
  let note = "선택한 기간에 저장된 실제 기록만 집계했습니다.";

  if (canCompare) {
    statement = comparisonStatement(report.comparison, wonFormatter);
    note = `${report.comparison.requiredWorkDays}일 대 ${report.comparison.requiredWorkDays}일, 같은 근무일 수 기준입니다.`;
  } else if (revenue === 0 && count === 0) {
    statement = { before: "선택한 기간에 기록된 ", value: "실적이 없습니다", after: "." };
    if (report?.mode === "thisSettlement") note = insufficientComparisonNote(report?.comparison);
  } else {
    statement = { before: "조회 기간 실제 매출은 ", value: formattedRevenue, after: "입니다." };
    if (report?.mode === "thisSettlement" && report?.comparison?.available !== true) {
      note = insufficientComparisonNote(report?.comparison);
    }
  }

  return Object.freeze({
    title: String(title),
    statement: Object.freeze(statement),
    comparisonAvailable: canCompare,
    meta: `${rangeText} · 실제 ${formattedRevenue} · ${formatCount(count)} · 근무 ${workDays}일`,
    note,
  });
}

export function renderInstrumentInsight(container, report, { title = "이번 정산", formatWon = defaultFormatWon } = {}) {
  if (!container) return null;
  const model = buildInstrumentInsightModel(report, { title, formatWon });
  container.innerHTML = `
    <article class="instrument-insight-card" aria-label="${escapeHtml(model.title)} 요약">
      <p class="instrument-insight-title">${escapeHtml(model.title)}</p>
      <p class="instrument-insight-statement">${escapeHtml(model.statement.before)}<strong class="instrument-insight-value">${escapeHtml(model.statement.value)}</strong>${escapeHtml(model.statement.after)}</p>
      <p class="instrument-insight-meta">${escapeHtml(model.meta)}</p>
      <p class="instrument-insight-note">${escapeHtml(model.note)}</p>
    </article>
  `;
  return model;
}

function compactNumber(value, divisor, suffix) {
  const scaled = value / divisor;
  return `${ONE_DECIMAL_FORMAT.format(scaled)}${suffix}`;
}

function compactMetricValue(value, metric) {
  const rounded = Math.round(finiteNumber(value));
  const absolute = Math.abs(rounded);
  if (metric === "revenue") {
    if (absolute >= 100_000_000) return compactNumber(rounded, 100_000_000, "억");
    if (absolute >= 10_000) return compactNumber(rounded, 10_000, "만");
    return NUMBER_FORMAT.format(rounded);
  }
  if (absolute >= 10_000) return compactNumber(rounded, 10_000, "만");
  return NUMBER_FORMAT.format(rounded);
}

function exactMetricValue(value, metric) {
  return metric === "count" ? formatCount(value) : defaultFormatWon(value);
}

export function buildWeekdayBarsModel(days, metric) {
  if (metric !== "count" && metric !== "revenue") {
    throw new RangeError("요일 통계 단위는 count 또는 revenue여야 합니다.");
  }
  const rows = WEEKDAYS.map(({ dayIndex, label }) => ({ dayIndex, label, count: 0, revenue: 0 }));
  const rowByDay = new Map(rows.map((row) => [row.dayIndex, row]));
  const validDateKeys = [];
  let ignoredDayCount = 0;

  for (const day of Array.isArray(days) ? days : []) {
    const parsed = parseLocalDateKey(day?.dateKey);
    if (!parsed) {
      ignoredDayCount += 1;
      continue;
    }
    const row = rowByDay.get(parsed.weekday);
    row.count += finiteNumber(day?.count);
    row.revenue += finiteNumber(day?.revenue);
    validDateKeys.push(parsed.dateKey);
  }

  validDateKeys.sort();
  const values = rows.map((row) => row[metric]);
  const maxValue = Math.max(0, ...values);
  const empty = values.every((value) => value === 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  const range = validDateKeys.length
    ? { start: validDateKeys[0], end: validDateKeys.at(-1) }
    : { start: null, end: null };
  const unit = metric === "count" ? "개" : "원";
  const metricLabel = metric === "count" ? "배송 상품 수" : "매출";

  return Object.freeze({
    metric,
    metricLabel,
    unit,
    total,
    empty,
    ignoredDayCount,
    range: Object.freeze(range),
    rangeText: formatRange(range),
    rows: Object.freeze(rows.map((row) => Object.freeze({
      ...row,
      value: row[metric],
      displayValue: compactMetricValue(row[metric], metric),
      exactValue: exactMetricValue(row[metric], metric),
      fillPercent: maxValue > 0 ? Math.max(0, (row[metric] / maxValue) * 100) : 0,
      isPeak: maxValue > 0 && row[metric] === maxValue,
    }))),
  });
}

export function renderWeekdayBars(container, days, metric) {
  if (!container) return null;
  const model = buildWeekdayBarsModel(days, metric);
  const totalText = exactMetricValue(model.total, model.metric);
  const meta = `실제 ${model.metricLabel} · ${model.rangeText} · 단위: ${model.unit} · 합계 ${totalText}`;
  const chart = model.empty
    ? `<p class="instrument-weekdays-empty" role="status">선택한 기간에 ${model.metricLabel} 기록이 없습니다.</p>`
    : `<div class="instrument-weekdays-chart" role="list" aria-label="요일별 실제 ${model.metricLabel}">
        ${model.rows.map((row) => `
          <div class="weekday-column ${row.isPeak ? "is-peak" : "is-muted"}" role="listitem" aria-label="${row.label}요일, ${escapeHtml(row.exactValue)}" title="${row.label}요일 · ${escapeHtml(row.exactValue)}">
            <span class="weekday-value" aria-hidden="true">${escapeHtml(row.displayValue)}</span>
            <span class="weekday-track" aria-hidden="true"><span class="weekday-fill" style="--weekday-fill: ${row.fillPercent.toFixed(2)}%"></span></span>
            <span class="weekday-label" aria-hidden="true">${row.label}</span>
          </div>
        `).join("")}
      </div>`;

  container.innerHTML = `
    <section class="instrument-weekdays" aria-label="요일별 ${model.metricLabel}">
      <div class="instrument-weekdays-heading">
        <h3>요일별</h3>
        <span class="instrument-weekdays-unit">단위: ${model.unit}</span>
      </div>
      ${chart}
      <p class="instrument-weekdays-meta">${escapeHtml(meta)}</p>
    </section>
  `;
  return model;
}
