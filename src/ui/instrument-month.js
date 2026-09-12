const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const NUMBER_FORMAT = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });

function finiteRounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function finiteNonNegative(value) {
  return Math.max(0, finiteRounded(value));
}

function parseLocalDateKey(value) {
  const match = DATE_KEY_RE.exec(String(value ?? ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return {
    dateKey: `${match[1]}-${match[2]}-${match[3]}`,
    day,
    weekday: WEEKDAYS[date.getDay()],
  };
}

function normalizeRoutes(routes) {
  if (!Array.isArray(routes)) return [];
  return routes.map((route) => String(route ?? "").trim()).filter(Boolean);
}

/** Mirrors Java String.hashCode() and Math.floorMod(hash, 4) after Android route normalization. */
export function routeColorSlot(code) {
  const normalized = String(code ?? "").trim().toUpperCase();
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (Math.imul(hash, 31) + normalized.charCodeAt(index)) | 0;
  }
  return ((hash % 4) + 4) % 4 + 1;
}

export function buildMonthRecordListModel(records, { selectedDate = "", today = "" } = {}) {
  const selected = parseLocalDateKey(selectedDate)?.dateKey || "";
  const todayKey = parseLocalDateKey(today)?.dateKey || "";
  const rows = [];

  for (const record of Array.isArray(records) ? records : []) {
    const date = parseLocalDateKey(record?.dateKey);
    if (!date) continue;
    const hasRecord = record?.hasRecord === true;
    const off = hasRecord && record?.off === true;
    const routes = hasRecord && !off ? normalizeRoutes(record?.routes) : [];
    const count = hasRecord && !off ? finiteNonNegative(record?.count) : 0;
    const revenue = hasRecord && !off ? finiteRounded(record?.revenue) : 0;
    const future = Boolean(todayKey) && date.dateKey > todayKey;
    const planned = future && hasRecord && !off && routes.length > 0 && count === 0 && revenue === 0;
    const empty = !hasRecord;
    const summary = off
      ? "휴무"
      : planned
        ? `${routes.join(" · ")} · 근무 예정`
        : empty
          ? "기록 없음"
          : `${routes.length ? `${routes.join(" · ")} · ` : "기록 있음 · "}${NUMBER_FORMAT.format(count)}개`;

    rows.push(Object.freeze({
      ...date,
      routes: Object.freeze(routes),
      count,
      revenue,
      formattedRevenue: NUMBER_FORMAT.format(revenue),
      hasRecord,
      off,
      empty,
      planned,
      selected: date.dateKey === selected,
      today: date.dateKey === todayKey,
      summary,
    }));
  }

  return Object.freeze(rows.sort((a, b) => b.dateKey.localeCompare(a.dateKey)));
}

function appendTextElement(documentRef, parent, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function clearContainer(container) {
  if (typeof container.replaceChildren === "function") {
    container.replaceChildren();
    return;
  }
  while (container.firstChild) container.removeChild(container.firstChild);
}

export function renderMonthRecordList(container, records, { selectedDate = "", today = "", onSelect } = {}) {
  if (!container) return Object.freeze([]);
  const documentRef = container.ownerDocument || globalThis.document;
  if (!documentRef?.createElement) throw new TypeError("월 기록 목록을 렌더링할 DOM이 필요합니다.");
  const model = buildMonthRecordListModel(records, { selectedDate, today });

  clearContainer(container);
  container.classList.add("month-record-list");

  for (const row of model) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.className = "month-record-row";
    button.classList.toggle("is-off", row.off);
    button.classList.toggle("is-empty", row.empty);
    button.classList.toggle("is-planned", row.planned);
    button.classList.toggle("selected", row.selected);
    button.classList.toggle("today", row.today);
    button.dataset.date = row.dateKey;
    button.setAttribute("aria-pressed", String(row.selected));
    if (row.today) button.setAttribute("aria-current", "date");
    button.setAttribute("aria-label", `${row.dateKey}, ${row.weekday}요일, ${row.summary}${row.hasRecord && !row.off && !row.planned ? `, ${row.formattedRevenue}원` : ""}`);

    const day = documentRef.createElement("span");
    day.className = "record-day";
    appendTextElement(documentRef, day, "strong", "record-day-number", String(row.day));
    appendTextElement(documentRef, day, "small", "record-weekday", row.weekday);
    button.appendChild(day);

    const routeBars = documentRef.createElement("span");
    routeBars.className = "record-route-bars";
    routeBars.setAttribute("aria-hidden", "true");
    for (const route of row.routes) {
      const bar = documentRef.createElement("span");
      bar.className = "record-route-bar";
      bar.style.setProperty("--rc", `var(--s-r${routeColorSlot(route)})`);
      routeBars.appendChild(bar);
    }
    button.appendChild(routeBars);

    appendTextElement(documentRef, button, "span", "record-route-summary", row.summary);

    const amount = documentRef.createElement("span");
    amount.className = "record-amount";
    if (row.hasRecord && !row.off && !row.planned) {
      appendTextElement(documentRef, amount, "strong", "record-amount-value", row.formattedRevenue);
      appendTextElement(documentRef, amount, "small", "record-amount-unit", "원");
    } else {
      amount.textContent = row.off ? "휴무" : "—";
    }
    button.appendChild(amount);

    if (typeof onSelect === "function") {
      button.addEventListener("click", () => onSelect(row.dateKey));
    }
    container.appendChild(button);
  }

  return model;
}
