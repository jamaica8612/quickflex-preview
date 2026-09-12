const DEFAULT_DISPLAY_PREFERENCES = Object.freeze({
  monthView: "calendar",
  calendarMetric: "amount",
});

const MONTH_VIEWS = new Set(["calendar", "list"]);
const CALENDAR_METRICS = new Set(["amount", "count"]);
const STORAGE_KEY_PREFIX = "quickflex-public-preview-display:";

function defaults() {
  return { ...DEFAULT_DISPLAY_PREFERENCES };
}

function normalizedUserId(userId) {
  return typeof userId === "string" ? userId.trim() : "";
}

function normalizePreferences(value, fallback = DEFAULT_DISPLAY_PREFERENCES) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    monthView: MONTH_VIEWS.has(source.monthView) ? source.monthView : fallback.monthView,
    calendarMetric: CALENDAR_METRICS.has(source.calendarMetric) ? source.calendarMetric : fallback.calendarMetric,
  };
}

function readStoredPreferences(storage, userId) {
  const id = normalizedUserId(userId);
  if (!id || !storage || typeof storage.getItem !== "function") {
    return { available: false, preferences: defaults() };
  }

  try {
    const raw = storage.getItem(`${STORAGE_KEY_PREFIX}${id}`);
    if (raw === null) return { available: true, preferences: defaults() };
    try {
      return { available: true, preferences: normalizePreferences(JSON.parse(raw)) };
    } catch (_) {
      return { available: true, preferences: defaults() };
    }
  } catch (_) {
    return { available: false, preferences: defaults() };
  }
}

export function readDisplayPreferences(storage, userId) {
  return readStoredPreferences(storage, userId).preferences;
}

export function writeDisplayPreferences(storage, userId, patch) {
  const id = normalizedUserId(userId);
  const stored = readStoredPreferences(storage, id);
  if (!id || !stored.available || !storage || typeof storage.setItem !== "function") return defaults();

  const preferences = normalizePreferences(patch, stored.preferences);
  try {
    storage.setItem(`${STORAGE_KEY_PREFIX}${id}`, JSON.stringify(preferences));
    return preferences;
  } catch (_) {
    return defaults();
  }
}
