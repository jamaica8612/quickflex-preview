const DB_NAME = "quickflex-public-preview-commercial-v1";
const DB_VERSION = 1;
const EXPENSE_STORE = "expenses";
const RECEIPT_STORE = "receipts";

export const PREVIEW_OWNER_ID = "public-preview-user";
export const MAX_RECEIPT_SOURCE_BYTES = 12 * 1024 * 1024;
export const MAX_RECEIPT_STORED_BYTES = 2_500_000;
export const MAX_RECEIPT_EDGE = 1800;

export const EXPENSE_CATEGORIES = Object.freeze([
  Object.freeze({ value: "fuel", label: "주유" }),
  Object.freeze({ value: "ev", label: "전기차 충전" }),
  Object.freeze({ value: "maintenance", label: "차량 정비" }),
  Object.freeze({ value: "toll", label: "통행료·주차" }),
  Object.freeze({ value: "other", label: "기타" }),
]);

const CATEGORY_VALUES = new Set(EXPENSE_CATEGORIES.map(({ value }) => value));
const FUEL_TYPES = new Set(["gasoline", "diesel", "lpg"]);
const CHARGE_TYPES = new Set(["fast", "slow"]);
const RECEIPT_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const [year, month, day] = String(value).split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function optionalText(value, maxLength) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, maxLength) : "";
}

function normalizeWon(value) {
  const raw = String(value ?? "").trim().replace(/[\s,]/g, "");
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) return null;
  return raw.replace(/^0+(?=\d)/, "");
}

function normalizeOptionalInteger(value) {
  const raw = String(value ?? "").trim().replace(/[\s,]/g, "");
  if (!raw) return "";
  if (!/^\d+$/.test(raw)) return null;
  return raw.replace(/^0+(?=\d)/, "");
}

function normalizeOptionalDecimal(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (!/^(?:\d+|\d*\.\d+)$/.test(raw)) return null;
  const [integer, fraction] = raw.split(".");
  const normalizedInteger = (integer || "0").replace(/^0+(?=\d)/, "");
  return fraction === undefined ? normalizedInteger : `${normalizedInteger}.${fraction}`;
}

export function validateExpense(input = {}) {
  const errors = {};
  const date = String(input.date || "");
  const amount = normalizeWon(input.amount);
  const category = String(input.category || "");
  const odometerKm = normalizeOptionalInteger(input.odometerKm);
  const fuelLiters = normalizeOptionalDecimal(input.fuelLiters);
  const chargeKwh = normalizeOptionalDecimal(input.chargeKwh);
  const id = optionalText(input.id, 100);

  if (id && !UUID_PATTERN.test(id)) errors.id = "지출 ID 형식이 올바르지 않습니다.";
  if (!isDateKey(date)) errors.date = "실제 지출일을 확인해 주세요.";
  if (!amount) errors.amount = "0원보다 큰 금액을 숫자로 입력해 주세요.";
  if (!CATEGORY_VALUES.has(category)) errors.category = "지출 분류를 선택해 주세요.";
  if (odometerKm === null) errors.odometerKm = "주행거리는 0 이상의 정수로 입력해 주세요.";
  if (category === "fuel" && fuelLiters === null) errors.fuelLiters = "주유량은 0 이상의 숫자로 입력해 주세요.";
  if (category === "ev" && chargeKwh === null) errors.chargeKwh = "충전량은 0 이상의 숫자로 입력해 주세요.";
  if (category === "fuel" && input.fuelType && !FUEL_TYPES.has(String(input.fuelType))) errors.fuelType = "유종을 확인해 주세요.";
  if (category === "ev" && input.chargeType && !CHARGE_TYPES.has(String(input.chargeType))) errors.chargeType = "충전 방식을 확인해 주세요.";

  return {
    valid: Object.keys(errors).length === 0,
    errors,
    value: {
      id,
      date,
      amount: amount || "",
      category,
      memo: optionalText(input.memo, 300),
      vendor: optionalText(input.vendor, 100),
      odometerKm: odometerKm || "",
      workId: optionalText(input.workId, 100),
      fuelType: category === "fuel" && FUEL_TYPES.has(String(input.fuelType || "")) ? String(input.fuelType) : "",
      fuelLiters: category === "fuel" ? (fuelLiters || "") : "",
      chargeKwh: category === "ev" ? (chargeKwh || "") : "",
      chargeType: category === "ev" && CHARGE_TYPES.has(String(input.chargeType || "")) ? String(input.chargeType) : "",
    },
  };
}

export function validateReceiptFile(file) {
  if (!file || typeof file.size !== "number" || !Number.isFinite(file.size)) return { valid: false, error: "영수증 사진을 다시 선택해 주세요." };
  if (!RECEIPT_MIME_TYPES.has(String(file.type || "").toLowerCase())) {
    return { valid: false, error: "JPG, PNG, WebP 사진만 첨부할 수 있습니다." };
  }
  if (file.size <= 0) return { valid: false, error: "비어 있는 사진은 첨부할 수 없습니다." };
  if (file.size > MAX_RECEIPT_SOURCE_BYTES) {
    return { valid: false, error: "원본 사진은 12MB 이하여야 합니다." };
  }
  return { valid: true, error: "" };
}

function validateStoredReceiptBlob(blob) {
  const check = validateReceiptFile(blob);
  if (!check.valid) return check;
  if (String(blob.type || "").toLowerCase() !== "image/jpeg") {
    return { valid: false, error: "저장된 영수증 형식이 JPEG가 아닙니다." };
  }
  if (blob.size > MAX_RECEIPT_STORED_BYTES) {
    return { valid: false, error: "저장된 영수증 용량이 미리보기 제한을 넘었습니다." };
  }
  return check;
}

export async function receiptBlobToDataUrl(blob, { stored = false } = {}) {
  const check = stored ? validateStoredReceiptBlob(blob) : validateReceiptFile(blob);
  if (!check.valid) throw new Error(check.error);
  if (typeof globalThis.FileReader !== "function") throw new Error("이 브라우저에서는 영수증 사진을 화면에 표시할 수 없습니다.");
  const result = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result), { once: true });
    reader.addEventListener("error", () => reject(reader.error || new Error("영수증 사진을 화면용으로 읽지 못했습니다.")), { once: true });
    reader.addEventListener("abort", () => reject(new Error("영수증 사진 읽기가 중단되었습니다.")), { once: true });
    reader.readAsDataURL(blob);
  });
  if (typeof result !== "string" || !/^data:image\/(?:jpeg|png|webp);base64,/i.test(result)) {
    throw new Error("영수증 사진의 화면 표시 형식을 확인할 수 없습니다.");
  }
  return result;
}

async function displayReceiptBlob(image, blob, options = {}) {
  const dataUrl = await receiptBlobToDataUrl(blob, options);
  image.removeAttribute("src");
  if (typeof image.decode === "function") {
    image.src = dataUrl;
    try {
      await image.decode();
    } catch (_) {
      image.removeAttribute("src");
      throw new Error("영수증 사진을 해석하지 못했습니다. 저장 기록은 변경하지 않았습니다.");
    }
  } else {
    await new Promise((resolve, reject) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("영수증 사진을 해석하지 못했습니다. 저장 기록은 변경하지 않았습니다.")), { once: true });
      image.src = dataUrl;
    });
  }
  if (!image.naturalWidth || !image.naturalHeight) {
    image.removeAttribute("src");
    throw new Error("영수증 사진의 크기를 확인하지 못했습니다. 저장 기록은 변경하지 않았습니다.");
  }
  return dataUrl;
}

export function filterAndSummarizeExpenses(expenses, { month = "", category = "" } = {}) {
  const rows = (Array.isArray(expenses) ? expenses : [])
    .filter((expense) => !month || String(expense.date || "").startsWith(`${month}-`))
    .filter((expense) => !category || expense.category === category)
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  const total = rows.reduce((sum, expense) => sum + BigInt(normalizeWon(expense.amount) || "0"), 0n);
  return { rows, total: total.toString(), count: rows.length };
}

function createId(cryptoImpl = globalThis.crypto) {
  if (typeof cryptoImpl?.randomUUID === "function") return cryptoImpl.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof cryptoImpl?.getRandomValues === "function") cryptoImpl.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function idbUnavailableError() {
  return new Error("이 브라우저에서는 미리보기 지출 저장소를 사용할 수 없습니다.");
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || new Error("미리보기 저장 요청이 실패했습니다.")), { once: true });
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error || new Error("미리보기 저장이 중단되었습니다.")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error || new Error("미리보기 저장이 실패했습니다.")), { once: true });
  });
}

function openExpenseDatabase(indexedDbImpl) {
  if (!indexedDbImpl?.open) return Promise.reject(idbUnavailableError());
  return new Promise((resolve, reject) => {
    const request = indexedDbImpl.open(DB_NAME, DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(EXPENSE_STORE)) {
        const expenses = database.createObjectStore(EXPENSE_STORE, { keyPath: "id" });
        expenses.createIndex("ownerId", "ownerId", { unique: false });
        expenses.createIndex("date", "date", { unique: false });
      }
      if (!database.objectStoreNames.contains(RECEIPT_STORE)) {
        const receipts = database.createObjectStore(RECEIPT_STORE, { keyPath: "id" });
        receipts.createIndex("ownerId", "ownerId", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error || idbUnavailableError()), { once: true });
    request.addEventListener("blocked", () => reject(new Error("다른 미리보기 창을 닫고 다시 시도해 주세요.")), { once: true });
  });
}

async function runTransaction(indexedDbImpl, storeNames, mode, operation) {
  const database = await openExpenseDatabase(indexedDbImpl);
  try {
    const transaction = database.transaction(storeNames, mode);
    const completion = transactionDone(transaction);
    const stores = Object.fromEntries(storeNames.map((name) => [name, transaction.objectStore(name)]));
    const result = await operation(stores, transaction);
    await completion;
    return result;
  } finally {
    database.close();
  }
}

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("영수증 사진을 JPEG로 만들지 못했습니다.")), "image/jpeg", quality);
  });
}

async function decodeReceipt(file) {
  if (typeof globalThis.createImageBitmap === "function") {
    const bitmap = await globalThis.createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
  }
  if (!globalThis.document?.createElement) throw new Error("이 브라우저에서는 영수증 사진을 읽을 수 없습니다.");
  const image = document.createElement("img");
  await displayReceiptBlob(image, file);
  return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => image.removeAttribute("src") };
}

export async function compressReceiptImage(file) {
  const check = validateReceiptFile(file);
  if (!check.valid) throw new Error(check.error);
  const decoded = await decodeReceipt(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error("영수증 사진의 크기를 확인할 수 없습니다.");
    let scale = Math.min(1, MAX_RECEIPT_EDGE / Math.max(decoded.width, decoded.height));
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("이 브라우저에서는 영수증 사진을 압축할 수 없습니다.");
    let blob = null;
    for (const quality of [0.82, 0.7, 0.58]) {
      canvas.width = Math.max(1, Math.round(decoded.width * scale));
      canvas.height = Math.max(1, Math.round(decoded.height * scale));
      context.fillStyle = "white";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(decoded.image, 0, 0, canvas.width, canvas.height);
      blob = await canvasToJpeg(canvas, quality);
      if (blob.size <= MAX_RECEIPT_STORED_BYTES) break;
      scale *= 0.78;
    }
    if (!blob || blob.size > MAX_RECEIPT_STORED_BYTES) throw new Error("사진을 2.5MB 이하로 줄이지 못했습니다. 더 작은 사진을 선택해 주세요.");
    return blob;
  } finally {
    decoded.close();
  }
}

export function createExpenseStore({ indexedDB: indexedDbImpl = globalThis.indexedDB, ownerId = PREVIEW_OWNER_ID } = {}) {
  if (ownerId !== PREVIEW_OWNER_ID) throw new Error("공개 미리보기 지출은 격리된 미리보기 사용자 범위에서만 저장할 수 있습니다.");

  async function list(options = {}) {
    const all = await runTransaction(indexedDbImpl, [EXPENSE_STORE], "readonly", async (stores) => requestResult(stores[EXPENSE_STORE].getAll()));
    const owned = all.filter((expense) => expense?.ownerId === ownerId);
    return filterAndSummarizeExpenses(owned, options).rows;
  }

  async function get(id) {
    if (!id) return null;
    const expense = await runTransaction(indexedDbImpl, [EXPENSE_STORE], "readonly", async (stores) => requestResult(stores[EXPENSE_STORE].get(String(id))));
    return expense?.ownerId === ownerId ? expense : null;
  }

  async function put(input) {
    const validation = validateExpense(input);
    if (!validation.valid) {
      const error = new Error("지출 입력값을 확인해 주세요.");
      error.code = "validation";
      error.fields = validation.errors;
      throw error;
    }
    const id = validation.value.id || createId();
    const now = new Date().toISOString();
    return runTransaction(indexedDbImpl, [EXPENSE_STORE], "readwrite", async (stores) => {
      const current = await requestResult(stores[EXPENSE_STORE].get(id));
      if (current && current.ownerId !== ownerId) throw new Error("이 지출 기록에 접근할 수 없습니다.");
      const expense = {
        ...validation.value,
        id,
        ownerId,
        receiptStatus: current?.receiptStatus || "none",
        receiptError: current?.receiptError || "",
        createdAt: current?.createdAt || now,
        updatedAt: now,
      };
      await requestResult(stores[EXPENSE_STORE].put(expense));
      return expense;
    });
  }

  async function receipt(id) {
    if (!id) return null;
    const record = await runTransaction(indexedDbImpl, [RECEIPT_STORE], "readonly", async (stores) => requestResult(stores[RECEIPT_STORE].get(String(id))));
    return record?.ownerId === ownerId ? record.blob : null;
  }

  async function putReceipt(id, file) {
    const expense = await get(id);
    if (!expense) throw new Error("영수증을 연결할 지출 기록을 찾지 못했습니다.");
    let blob;
    try {
      blob = await compressReceiptImage(file);
    } catch (error) {
      await runTransaction(indexedDbImpl, [EXPENSE_STORE], "readwrite", async (stores) => {
        const current = await requestResult(stores[EXPENSE_STORE].get(id));
        if (!current || current.ownerId !== ownerId) return;
        await requestResult(stores[EXPENSE_STORE].put({
          ...current,
          receiptStatus: current.receiptStatus === "saved" ? "saved" : "error",
          receiptError: error.message,
          updatedAt: new Date().toISOString(),
        }));
      });
      throw error;
    }
    const now = new Date().toISOString();
    return runTransaction(indexedDbImpl, [EXPENSE_STORE, RECEIPT_STORE], "readwrite", async (stores) => {
      const current = await requestResult(stores[EXPENSE_STORE].get(id));
      if (!current || current.ownerId !== ownerId) throw new Error("영수증을 연결할 지출 기록을 찾지 못했습니다.");
      const currentReceipt = await requestResult(stores[RECEIPT_STORE].get(id));
      if (currentReceipt && currentReceipt.ownerId !== ownerId) throw new Error("이 영수증에 접근할 수 없습니다.");
      await requestResult(stores[RECEIPT_STORE].put({ id, ownerId, blob, mimeType: "image/jpeg", size: blob.size, updatedAt: now }));
      const updated = { ...current, receiptStatus: "saved", receiptError: "", receiptMimeType: "image/jpeg", receiptSize: blob.size, updatedAt: now };
      await requestResult(stores[EXPENSE_STORE].put(updated));
      return updated;
    });
  }

  async function removeReceipt(id) {
    return runTransaction(indexedDbImpl, [EXPENSE_STORE, RECEIPT_STORE], "readwrite", async (stores) => {
      const current = await requestResult(stores[EXPENSE_STORE].get(String(id)));
      if (!current || current.ownerId !== ownerId) return null;
      const currentReceipt = await requestResult(stores[RECEIPT_STORE].get(String(id)));
      if (currentReceipt && currentReceipt.ownerId !== ownerId) throw new Error("이 영수증에 접근할 수 없습니다.");
      await requestResult(stores[RECEIPT_STORE].delete(String(id)));
      const updated = { ...current, receiptStatus: "none", receiptError: "", receiptMimeType: "", receiptSize: 0, updatedAt: new Date().toISOString() };
      await requestResult(stores[EXPENSE_STORE].put(updated));
      return updated;
    });
  }

  async function remove(id) {
    return runTransaction(indexedDbImpl, [EXPENSE_STORE, RECEIPT_STORE], "readwrite", async (stores) => {
      const current = await requestResult(stores[EXPENSE_STORE].get(String(id)));
      if (!current || current.ownerId !== ownerId) return false;
      const currentReceipt = await requestResult(stores[RECEIPT_STORE].get(String(id)));
      if (!currentReceipt || currentReceipt.ownerId === ownerId) await requestResult(stores[RECEIPT_STORE].delete(String(id)));
      await requestResult(stores[EXPENSE_STORE].delete(String(id)));
      return true;
    });
  }

  async function clear() {
    return runTransaction(indexedDbImpl, [EXPENSE_STORE, RECEIPT_STORE], "readwrite", async (stores) => {
      const [expenses, receipts] = await Promise.all([
        requestResult(stores[EXPENSE_STORE].getAll()),
        requestResult(stores[RECEIPT_STORE].getAll()),
      ]);
      for (const expense of expenses) if (expense?.ownerId === ownerId) stores[EXPENSE_STORE].delete(expense.id);
      for (const item of receipts) if (item?.ownerId === ownerId) stores[RECEIPT_STORE].delete(item.id);
      return true;
    });
  }

  return Object.freeze({ list, get, put, receipt, putReceipt, removeReceipt, remove, clear });
}

let defaultStore;
function store() {
  defaultStore ||= createExpenseStore();
  return defaultStore;
}

export async function listExpenses(options = {}) { return store().list(options); }
export async function getExpense(id) { return store().get(id); }
export async function getReceipt(id) { return store().receipt(id); }
export async function saveReceipt(id, file) { return store().putReceipt(id, file); }
export async function deleteReceipt(id) { return store().removeReceipt(id); }
export async function deleteExpense(id) { return store().remove(id); }
export async function clearExpenses() { return store().clear(); }

export async function saveExpense(input, { receiptFile = input?.receiptFile } = {}) {
  const expense = await store().put(input);
  if (!receiptFile) return { expense, receiptError: null };
  try {
    const saved = await store().putReceipt(expense.id, receiptFile);
    return { expense: saved, receiptError: null };
  } catch (receiptError) {
    return { expense: await store().get(expense.id), receiptError };
  }
}

function formatWon(value) {
  try { return `${BigInt(String(value || "0")).toLocaleString("ko-KR")}원`; }
  catch (_) { return "금액 오류"; }
}

function categoryLabel(value) {
  return EXPENSE_CATEGORIES.find((category) => category.value === value)?.label || "기타";
}

export function formatExpenseWorkOption(work = {}) {
  const id = optionalText(work.id ?? work.workId, 100);
  if (!id) return "";
  const date = optionalText(work.workDate ?? work.date, 10);
  const shift = work.shift === "night" ? "야간" : work.shift === "day" ? "주간" : "근무조 미상";
  const routes = [...new Set([
    work.route,
    ...(Array.isArray(work.rows) ? work.rows.map((item) => item?.route) : []),
  ].flatMap((value) => String(value || "").split("|")).map((value) => value.trim()).filter(Boolean))];
  const routeText = routes.length > 2 ? `${routes.slice(0, 2).join(" · ")} 외 ${routes.length - 2}` : routes.join(" · ");
  const rawAmount = String(work.amount ?? "").replace(/[\s,]/g, "");
  const amountText = /^\d+$/.test(rawAmount) ? formatWon(rawAmount) : "금액 미확정";
  const shortId = id.length > 8 ? id.slice(0, 8) : id;
  const suppliedLabel = optionalText(work.label, 160);
  return [suppliedLabel || date || "업무", shift, routeText || amountText, routeText ? amountText : "", `#${shortId}`].filter(Boolean).join(" · ");
}

function setFieldError(root, name, message = "") {
  const input = root.querySelector(`[name="${name}"]`);
  const error = root.querySelector(`[data-error-for="${name}"]`);
  input?.setAttribute("aria-invalid", message ? "true" : "false");
  if (error) error.textContent = message;
}

function resolveToday(today) {
  const value = typeof today === "function" ? today() : today;
  return isDateKey(value) ? value : localDateKey();
}

export function mountExpenses(container, { onChange, getWorks, today } = {}) {
  if (!container?.querySelector) throw new Error("지출관리 화면을 넣을 컨테이너가 필요합니다.");
  container.innerHTML = `
    <section class="commercial-expenses" aria-labelledby="expense-title">
      <header class="expense-header">
        <div><p class="expense-eyebrow">공개 미리보기</p><h1 id="expense-title">지출관리</h1></div>
        <span class="expense-local-badge">이 기기에만 저장</span>
      </header>
      <p class="expense-boundary">이 기록과 영수증은 서버로 전송되지 않으며, 현재 미리보기 브라우저에만 저장됩니다.</p>

      <section class="expense-card expense-editor" aria-labelledby="expense-editor-title">
        <div class="expense-section-heading"><h2 id="expense-editor-title">빠른 지출 입력</h2><span>금액·분류 필수</span></div>
        <form data-role="form" novalidate>
          <div class="expense-form-grid">
            <div class="expense-field"><label for="expense-date">실제 지출일 <span aria-hidden="true">*</span></label><input id="expense-date" name="date" type="date" required /><p data-error-for="date" class="expense-field-error" aria-live="polite"></p></div>
            <div class="expense-field"><label for="expense-amount">금액 <span aria-hidden="true">*</span></label><div class="expense-unit-input"><input id="expense-amount" name="amount" type="text" inputmode="numeric" autocomplete="off" required aria-describedby="expense-amount-help" /><span>원</span></div><p id="expense-amount-help" class="expense-help">결제한 금액을 그대로 입력하세요.</p><p data-error-for="amount" class="expense-field-error" aria-live="polite"></p></div>
            <div class="expense-field expense-field-wide"><label for="expense-category">분류 <span aria-hidden="true">*</span></label><select id="expense-category" name="category" required>${EXPENSE_CATEGORIES.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}</select><p data-error-for="category" class="expense-field-error" aria-live="polite"></p></div>
          </div>
          <div data-role="fuel-fields" class="expense-conditional" hidden>
            <div class="expense-field"><label for="expense-fuel-type">유종 <span class="expense-optional">선택</span></label><select id="expense-fuel-type" name="fuelType"><option value="">모름 / 미입력</option><option value="gasoline">휘발유</option><option value="diesel">경유</option><option value="lpg">LPG</option></select></div>
            <div class="expense-field"><label for="expense-fuel-liters">주유량 <span class="expense-optional">선택</span></label><div class="expense-unit-input"><input id="expense-fuel-liters" name="fuelLiters" type="text" inputmode="decimal" /><span>L</span></div><p data-error-for="fuelLiters" class="expense-field-error" aria-live="polite"></p></div>
          </div>
          <div data-role="ev-fields" class="expense-conditional" hidden>
            <div class="expense-field"><label for="expense-charge-kwh">충전량 <span class="expense-optional">선택</span></label><div class="expense-unit-input"><input id="expense-charge-kwh" name="chargeKwh" type="text" inputmode="decimal" /><span>kWh</span></div><p data-error-for="chargeKwh" class="expense-field-error" aria-live="polite"></p></div>
            <div class="expense-field"><label for="expense-charge-type">충전 방식 <span class="expense-optional">선택</span></label><select id="expense-charge-type" name="chargeType"><option value="">모름 / 미입력</option><option value="fast">급속</option><option value="slow">완속</option></select></div>
          </div>
          <details class="expense-more"><summary>추가 정보 <span>선택</span></summary>
            <div class="expense-form-grid">
              <div class="expense-field"><label for="expense-vendor">상호·주유소·충전소</label><input id="expense-vendor" name="vendor" type="text" maxlength="100" autocomplete="organization" /></div>
              <div class="expense-field"><label for="expense-odometer">주행거리</label><div class="expense-unit-input"><input id="expense-odometer" name="odometerKm" type="text" inputmode="numeric" /><span>km</span></div><p data-error-for="odometerKm" class="expense-field-error" aria-live="polite"></p></div>
              <div class="expense-field expense-field-wide"><label for="expense-work">특정 업무 연결</label><select id="expense-work" name="workId"><option value="">연결하지 않음</option></select></div>
              <div class="expense-field expense-field-wide"><label for="expense-memo">메모</label><textarea id="expense-memo" name="memo" maxlength="300" rows="3"></textarea></div>
            </div>
          </details>
          <fieldset class="expense-receipt-fieldset"><legend>영수증 사진 <span class="expense-optional">선택</span></legend>
            <div class="expense-receipt-actions">
              <label class="expense-file-button">카메라 촬영<input name="camera" data-role="camera" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" /></label>
              <label class="expense-file-button">갤러리 선택<input name="gallery" data-role="gallery" type="file" accept="image/jpeg,image/png,image/webp" /></label>
              <button data-role="remove-pending-receipt" class="expense-text-button" type="button" hidden>선택 취소</button>
            </div>
            <div data-role="pending-receipt" class="expense-pending-receipt" hidden><img alt="선택한 영수증 미리보기" /><p></p></div>
            <p class="expense-help">JPG·PNG·WebP, 원본 12MB 이하. 저장 시 읽을 수 있는 JPEG로 압축하며 위치 등 사진 메타데이터를 제거합니다.</p>
          </fieldset>
          <div data-role="form-status" class="expense-status" aria-live="polite" tabindex="-1"></div>
          <div class="expense-form-actions"><button data-role="cancel-edit" class="expense-secondary-button" type="button" hidden>수정 취소</button><button data-role="submit" class="expense-primary-button" type="submit">지출 저장</button></div>
        </form>
      </section>

      <section class="expense-card expense-history" aria-labelledby="expense-history-title">
        <div class="expense-section-heading"><div><h2 id="expense-history-title">지출 내역</h2><p data-role="total-period"></p></div><strong data-role="total">0원</strong></div>
        <div class="expense-filters">
          <div class="expense-field"><label for="expense-month">달력월</label><input id="expense-month" data-role="month" type="month" /></div>
          <div class="expense-field"><label for="expense-filter-category">분류</label><select id="expense-filter-category" data-role="category-filter"><option value="">전체 분류</option>${EXPENSE_CATEGORIES.map(({ value, label }) => `<option value="${value}">${label}</option>`).join("")}</select></div>
        </div>
        <div data-role="list-status" class="expense-status" aria-live="polite"></div>
        <div data-role="list" class="expense-list"></div>
      </section>

      <dialog data-role="receipt-dialog" class="expense-receipt-dialog" aria-labelledby="expense-receipt-title">
        <div class="expense-dialog-heading"><h2 id="expense-receipt-title">영수증</h2><button data-role="close-dialog" type="button" aria-label="영수증 확대 보기 닫기">닫기</button></div>
        <img data-role="receipt-full" alt="확대된 영수증" />
      </dialog>
    </section>`;

  const root = container.querySelector(".commercial-expenses");
  const form = root.querySelector('[data-role="form"]');
  const fields = form.elements;
  const state = {
    editingId: "",
    draftId: "",
    pendingFile: null,
    pendingPreviewRevision: 0,
    receiptDisplayRevision: 0,
    listRenderRevision: 0,
    worksLoadRevision: 0,
    destroyed: false,
  };
  const monthInput = root.querySelector('[data-role="month"]');
  const categoryFilter = root.querySelector('[data-role="category-filter"]');
  const listElement = root.querySelector('[data-role="list"]');
  const formStatus = root.querySelector('[data-role="form-status"]');
  const listStatus = root.querySelector('[data-role="list-status"]');
  const submitButton = root.querySelector('[data-role="submit"]');
  const cancelEditButton = root.querySelector('[data-role="cancel-edit"]');
  const dialog = root.querySelector('[data-role="receipt-dialog"]');
  monthInput.value = resolveToday(today).slice(0, 7);

  function announce(message, kind = "") {
    formStatus.textContent = message;
    formStatus.dataset.kind = kind;
  }

  function updateConditionalFields() {
    root.querySelector('[data-role="fuel-fields"]').hidden = fields.category.value !== "fuel";
    root.querySelector('[data-role="ev-fields"]').hidden = fields.category.value !== "ev";
  }

  function clearPendingReceipt({ invalidate = true } = {}) {
    if (invalidate) state.pendingPreviewRevision += 1;
    state.pendingFile = null;
    fields.camera.value = "";
    fields.gallery.value = "";
    const preview = root.querySelector('[data-role="pending-receipt"]');
    preview.hidden = true;
    preview.querySelector("img").removeAttribute("src");
    preview.querySelector("p").textContent = "";
    root.querySelector('[data-role="remove-pending-receipt"]').hidden = true;
  }

  async function setPendingReceipt(file) {
    const check = validateReceiptFile(file);
    if (!check.valid) {
      clearPendingReceipt();
      announce(check.error, "error");
      return;
    }
    const previewRevision = state.pendingPreviewRevision + 1;
    state.pendingPreviewRevision = previewRevision;
    clearPendingReceipt({ invalidate: false });
    state.pendingFile = file;
    const preview = root.querySelector('[data-role="pending-receipt"]');
    preview.hidden = false;
    const image = preview.querySelector("img");
    preview.querySelector("p").textContent = "영수증 사진을 확인하는 중입니다.";
    root.querySelector('[data-role="remove-pending-receipt"]').hidden = false;
    announce("영수증 사진을 화면에 표시할 수 있는지 확인하고 있습니다.");
    try {
      await displayReceiptBlob(image, file);
      if (state.destroyed || previewRevision !== state.pendingPreviewRevision) return;
      preview.querySelector("p").textContent = `${Math.max(1, Math.round(file.size / 1024)).toLocaleString("ko-KR")}KB · 저장할 때 JPEG로 압축`;
      announce("영수증 사진을 선택했습니다. 지출을 저장하면 함께 보관됩니다.");
    } catch (error) {
      if (state.destroyed || previewRevision !== state.pendingPreviewRevision) return;
      clearPendingReceipt();
      announce(`사진을 표시하지 못해 선택을 취소했습니다: ${error.message}`, "error");
    }
  }

  function valuesFromForm() {
    return {
      id: state.draftId,
      date: fields.date.value,
      amount: fields.amount.value,
      category: fields.category.value,
      memo: fields.memo.value,
      vendor: fields.vendor.value,
      odometerKm: fields.odometerKm.value,
      workId: fields.workId.value,
      fuelType: fields.fuelType.value,
      fuelLiters: fields.fuelLiters.value,
      chargeKwh: fields.chargeKwh.value,
      chargeType: fields.chargeType.value,
    };
  }

  function resetForm(category = fields.category.value || "other") {
    form.reset();
    state.editingId = "";
    state.draftId = "";
    fields.date.value = resolveToday(today);
    fields.category.value = CATEGORY_VALUES.has(category) ? category : "other";
    submitButton.textContent = "지출 저장";
    cancelEditButton.hidden = true;
    root.querySelector("#expense-editor-title").textContent = "빠른 지출 입력";
    for (const name of ["date", "amount", "category", "odometerKm", "fuelLiters", "chargeKwh"]) setFieldError(root, name);
    clearPendingReceipt();
    updateConditionalFields();
  }

  async function notifyChange(type, expense = null) {
    if (typeof onChange !== "function") return;
    const expenses = await listExpenses();
    await onChange({ type, expense, expenses });
  }

  async function populateWorks() {
    if (typeof getWorks !== "function") return;
    const loadRevision = ++state.worksLoadRevision;
    try {
      const works = await getWorks();
      if (state.destroyed || loadRevision !== state.worksLoadRevision || !Array.isArray(works)) return;
      const selected = fields.workId.value;
      fields.workId.replaceChildren(new Option("연결하지 않음", ""));
      for (const work of works) {
        const id = optionalText(work?.id ?? work?.workId, 100);
        if (!id) continue;
        fields.workId.append(new Option(formatExpenseWorkOption(work), id));
      }
      if (selected && ![...fields.workId.options].some((option) => option.value === selected)) {
        fields.workId.append(new Option(`현재 연결 유지 · #${selected.slice(0, 8)}`, selected));
      }
      fields.workId.value = selected;
    } catch (_) {
      if (state.destroyed || loadRevision !== state.worksLoadRevision) return;
      announce("업무 목록을 불러오지 못했습니다. 업무 연결 없이 지출은 저장할 수 있습니다.", "warning");
    }
  }

  async function openReceipt(expense) {
    const displayRevision = ++state.receiptDisplayRevision;
    listStatus.textContent = "영수증 사진을 불러오는 중입니다.";
    listStatus.dataset.kind = "";
    try {
      const blob = await getReceipt(expense.id);
      if (!blob) throw new Error("저장된 영수증 사진을 찾지 못했습니다.");
      const image = root.querySelector('[data-role="receipt-full"]');
      await displayReceiptBlob(image, blob, { stored: true });
      if (state.destroyed || displayRevision !== state.receiptDisplayRevision) return;
      root.querySelector("#expense-receipt-title").textContent = `${expense.date} 영수증`;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      listStatus.textContent = "";
    } catch (error) {
      if (state.destroyed || displayRevision !== state.receiptDisplayRevision) return;
      listStatus.textContent = `영수증 저장 기록은 유지했습니다. 화면 표시 실패: ${error.message || "사진을 불러오지 못했습니다."}`;
      listStatus.dataset.kind = "error";
    }
  }

  function beginEdit(expense) {
    state.editingId = expense.id;
    state.draftId = expense.id;
    for (const name of ["date", "amount", "category", "memo", "vendor", "odometerKm", "workId", "fuelType", "fuelLiters", "chargeKwh", "chargeType"]) {
      if (fields[name]) fields[name].value = expense[name] || "";
    }
    submitButton.textContent = "수정 저장";
    cancelEditButton.hidden = false;
    root.querySelector("#expense-editor-title").textContent = "지출 내역 수정";
    updateConditionalFields();
    clearPendingReceipt();
    form.scrollIntoView?.({ behavior: "smooth", block: "start" });
    fields.amount.focus();
    announce(expense.receiptStatus === "error" ? "지출은 저장되어 있습니다. 영수증을 다시 선택해 첨부할 수 있습니다." : "선택한 지출을 수정하고 있습니다.", expense.receiptStatus === "error" ? "warning" : "");
  }

  async function renderList() {
    const renderRevision = ++state.listRenderRevision;
    listElement.setAttribute("aria-busy", "true");
    listStatus.dataset.kind = "";
    listStatus.textContent = "지출 내역을 불러오는 중입니다.";
    try {
      const expenses = await listExpenses({ month: monthInput.value, category: categoryFilter.value });
      if (state.destroyed || renderRevision !== state.listRenderRevision) return;
      const summary = filterAndSummarizeExpenses(expenses);
      root.querySelector('[data-role="total"]').textContent = formatWon(summary.total);
      root.querySelector('[data-role="total-period"]').textContent = monthInput.value ? `${monthInput.value.replace("-", "년 ")}월 · ${summary.count}건` : `전체 기간 · ${summary.count}건`;
      listElement.replaceChildren();
      listStatus.textContent = "";
      if (!expenses.length) {
        const empty = document.createElement("p");
        empty.className = "expense-empty";
        empty.textContent = "선택한 기간에 기록된 지출이 없습니다.";
        listElement.append(empty);
        return;
      }
      for (const expense of expenses) {
        const article = document.createElement("article");
        article.className = "expense-item";
        const main = document.createElement("div");
        main.className = "expense-item-main";
        const heading = document.createElement("div");
        const title = document.createElement("h3");
        title.textContent = expense.vendor || categoryLabel(expense.category);
        const meta = document.createElement("p");
        meta.textContent = `${expense.date} · ${categoryLabel(expense.category)}${expense.workId ? " · 업무 연결됨" : ""}`;
        heading.append(title, meta);
        const amount = document.createElement("strong");
        amount.textContent = formatWon(expense.amount);
        main.append(heading, amount);
        article.append(main);
        if (expense.memo) {
          const memo = document.createElement("p");
          memo.className = "expense-item-memo";
          memo.textContent = expense.memo;
          article.append(memo);
        }
        if (expense.receiptStatus === "saved") {
          const thumb = document.createElement("button");
          thumb.type = "button";
          thumb.className = "expense-receipt-thumb";
          thumb.setAttribute("aria-label", `${expense.date} 영수증 확대 보기`);
          const image = document.createElement("img");
          image.alt = "";
          image.loading = "lazy";
          const caption = document.createElement("span");
          caption.textContent = "영수증 사진 확인 중";
          thumb.append(image, caption);
          thumb.addEventListener("click", () => openReceipt(expense));
          article.append(thumb);
          getReceipt(expense.id).then(async (blob) => {
            if (!blob) throw new Error("저장된 영수증 사진을 찾지 못했습니다.");
            if (state.destroyed || renderRevision !== state.listRenderRevision) return;
            await displayReceiptBlob(image, blob, { stored: true });
            if (state.destroyed || renderRevision !== state.listRenderRevision) return;
            caption.textContent = "영수증 보기";
          }).catch((error) => {
            if (state.destroyed || renderRevision !== state.listRenderRevision) return;
            image.removeAttribute("src");
            caption.textContent = "사진 표시 실패 · 저장 기록 유지";
            caption.title = error.message || "영수증 사진을 표시하지 못했습니다.";
            article.dataset.receiptError = "true";
          });
          if (expense.receiptError) {
            const replacementError = document.createElement("button");
            replacementError.type = "button";
            replacementError.className = "expense-receipt-error";
            replacementError.textContent = "새 사진 저장 실패 · 기존 사진 유지됨 · 다시 선택";
            replacementError.title = expense.receiptError;
            replacementError.addEventListener("click", () => { beginEdit(expense); fields.gallery.click(); });
            article.append(replacementError);
          }
        } else if (expense.receiptStatus === "error") {
          const receiptError = document.createElement("button");
          receiptError.type = "button";
          receiptError.className = "expense-receipt-error";
          receiptError.textContent = `영수증 첨부 실패 · 다시 선택`;
          receiptError.title = expense.receiptError || "영수증을 저장하지 못했습니다.";
          receiptError.addEventListener("click", () => { beginEdit(expense); fields.gallery.click(); });
          article.append(receiptError);
        }
        const actions = document.createElement("div");
        actions.className = "expense-item-actions";
        const edit = document.createElement("button");
        edit.type = "button";
        edit.textContent = "수정";
        edit.addEventListener("click", () => beginEdit(expense));
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "is-danger";
        remove.textContent = "삭제";
        remove.addEventListener("click", async () => {
          if (!globalThis.confirm?.(`${expense.date} ${formatWon(expense.amount)} 지출을 삭제할까요? 연결된 영수증도 함께 삭제됩니다.`)) return;
          remove.disabled = true;
          try {
            await deleteExpense(expense.id);
            if (state.editingId === expense.id) resetForm(expense.category);
            await renderList();
            await notifyChange("delete", expense);
            listStatus.textContent = "지출과 연결된 영수증을 삭제했습니다.";
          } catch (error) {
            listStatus.textContent = error.message || "지출을 삭제하지 못했습니다.";
            listStatus.dataset.kind = "error";
            remove.disabled = false;
          }
        });
        actions.append(edit, remove);
        if (expense.receiptStatus === "saved") {
          const removeReceiptButton = document.createElement("button");
          removeReceiptButton.type = "button";
          removeReceiptButton.textContent = "사진 삭제";
          removeReceiptButton.addEventListener("click", async () => {
            if (!globalThis.confirm?.("영수증 사진만 삭제할까요? 지출 내역은 유지됩니다.")) return;
            try {
              const updated = await deleteReceipt(expense.id);
              await renderList();
              await notifyChange("receipt-delete", updated);
            } catch (error) {
              listStatus.textContent = error.message || "영수증 사진을 삭제하지 못했습니다.";
              listStatus.dataset.kind = "error";
            }
          });
          actions.prepend(removeReceiptButton);
        }
        article.append(actions);
        listElement.append(article);
      }
    } catch (error) {
      listElement.replaceChildren();
      listStatus.textContent = error.message || "지출 내역을 불러오지 못했습니다.";
      listStatus.dataset.kind = "error";
    } finally {
      listElement.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const validation = validateExpense(valuesFromForm());
    for (const name of ["date", "amount", "category", "odometerKm", "fuelLiters", "chargeKwh"]) setFieldError(root, name, validation.errors[name] || "");
    if (!validation.valid) {
      announce("필수 입력과 숫자 형식을 확인해 주세요.", "error");
      const first = Object.keys(validation.errors)[0];
      fields[first]?.focus();
      return;
    }
    state.draftId ||= createId();
    const wasEditing = Boolean(state.editingId);
    submitButton.disabled = true;
    form.setAttribute("aria-busy", "true");
    announce(state.pendingFile ? "지출을 저장한 뒤 영수증을 압축하고 있습니다." : "지출을 저장하고 있습니다.");
    try {
      const { expense, receiptError } = await saveExpense({ ...validation.value, id: state.draftId }, { receiptFile: state.pendingFile });
      const recentCategory = expense.category;
      resetForm(recentCategory);
      await renderList();
      await notifyChange(wasEditing ? "update" : "create", expense);
      if (receiptError) announce(`지출은 저장했습니다. 영수증은 저장하지 못했습니다: ${receiptError.message}`, "warning");
      else announce(wasEditing ? "지출 내역을 수정했습니다." : "지출을 저장했습니다.", "success");
    } catch (error) {
      if (error.code === "validation") {
        for (const [name, message] of Object.entries(error.fields || {})) setFieldError(root, name, message);
      }
      announce(error.message || "지출을 저장하지 못했습니다. 입력 내용은 화면에 남아 있습니다.", "error");
    } finally {
      submitButton.disabled = false;
      form.removeAttribute("aria-busy");
    }
  });

  fields.category.addEventListener("change", updateConditionalFields);
  // The commercial page stays mounted between bottom-navigation changes. Refresh only
  // this option list on focus so every other in-progress field remains untouched.
  fields.workId.addEventListener("focus", () => { void populateWorks(); });
  for (const name of ["date", "amount", "category", "odometerKm", "fuelLiters", "chargeKwh"]) fields[name].addEventListener("blur", () => {
    const validation = validateExpense(valuesFromForm());
    setFieldError(root, name, validation.errors[name] || "");
  });
  fields.camera.addEventListener("change", () => { void setPendingReceipt(fields.camera.files?.[0]); });
  fields.gallery.addEventListener("change", () => { void setPendingReceipt(fields.gallery.files?.[0]); });
  root.querySelector('[data-role="remove-pending-receipt"]').addEventListener("click", () => { clearPendingReceipt(); announce("선택한 영수증 사진을 제외했습니다."); });
  cancelEditButton.addEventListener("click", () => { const category = fields.category.value; resetForm(category); announce("수정을 취소했습니다."); });
  monthInput.addEventListener("change", renderList);
  categoryFilter.addEventListener("change", renderList);
  function closeReceiptDialog() {
    state.receiptDisplayRevision += 1;
    root.querySelector('[data-role="receipt-full"]').removeAttribute("src");
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
  }
  root.querySelector('[data-role="close-dialog"]').addEventListener("click", closeReceiptDialog);
  dialog.addEventListener("click", (event) => { if (event.target === dialog) closeReceiptDialog(); });

  resetForm("other");
  Promise.all([populateWorks(), listExpenses()]).then(([, expenses]) => {
    if (state.destroyed) return;
    const recent = expenses[0]?.category;
    if (CATEGORY_VALUES.has(recent) && !state.editingId) fields.category.value = recent;
    updateConditionalFields();
  }).catch(() => {});
  renderList();

  return Object.freeze({
    refresh: renderList,
    destroy() {
      state.destroyed = true;
      clearPendingReceipt();
      state.receiptDisplayRevision += 1;
      root.querySelector('[data-role="receipt-full"]').removeAttribute("src");
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      container.replaceChildren();
    },
  });
}
