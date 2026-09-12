import { WEEKDAYS } from "../config.js";

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

export function addDays(key, amount) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function todayKey() {
  return toDateKey(new Date());
}

export function formatShort(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatLong(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일(${WEEKDAYS[date.getDay()]})`;
}

export function formatRecordTitleDate(key) {
  const date = parseDateKey(key);
  return `${String(date.getFullYear()).slice(2)}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

export function formatLongShort(key) {
  const date = parseDateKey(key);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}(${WEEKDAYS[date.getDay()]})`;
}
