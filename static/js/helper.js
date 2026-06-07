export const PAYMENT_LABELS = { once: "일회성", monthly: "월간", annual: "연간" };
export const CURRENCY_LOCALE = { KRW: "ko-KR", JPY: "ja-JP" };

// Payment types and categories as they appear in the API payloads. Centralized
// so the values live in one place instead of being repeated as string literals.
export const PAYMENT_TYPES = { once: "once", monthly: "monthly", annual: "annual" };
export const CATEGORY = { fixed: "fixed", variable: "variable" };

export const FX_CURRENCIES = [
  "USD",
  "EUR",
  "JPY",
  "KRW",
  "CNY",
  "GBP",
  "AUD",
  "CAD",
  "HKD",
  "SGD",
  "THB",
  "TWD",
];

export const EVENTS = {
  currencyChanged: "gemsil:currency-changed",
  expenseChanged: "gemsil:expense-changed",
  goalChanged: "gemsil:goal-changed",
  actualChanged: "gemsil:actual-changed",
};

function padZero(n) {
  return String(n).padStart(2, "0");
}

export function formatCurrency(n, currency) {
  const cur = currency || "KRW";
  const locale = CURRENCY_LOCALE[cur] || "ko-KR";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(Math.round(n));
  } catch {
    return Math.round(n).toLocaleString() + " " + cur;
  }
}

// Renders an integer amount as-is, otherwise with two decimal places. Used for
// pre-filling editable amount inputs.
export function formatAmountValue(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

// "2026-06" -> "2026년 6월". Returns "-" for an empty/missing value.
export function formatMonthLabel(ym) {
  if (!ym) return "-";
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

// "MM월 DD일 HH:MM 저장" for the goal "saved at" note.
export function formatSavedAt(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return `${padZero(d.getMonth() + 1)}월 ${padZero(d.getDate())}일 ${padZero(d.getHours())}:${padZero(
    d.getMinutes(),
  )} 저장`;
}

// "DD일 HH시" — compact created-at label for the dashboard list.
export function formatTimestampShort(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return escapeHtml(s || "");
  return `${padZero(d.getDate())}일 ${padZero(d.getHours())}시`;
}

// "MM월 DD일 HH시 MM분 SS초" — full created-at label (tooltip).
export function formatTimestampFull(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return escapeHtml(s || "");
  return `${padZero(d.getMonth() + 1)}월 ${padZero(d.getDate())}일 ${padZero(d.getHours())}시 ${padZero(
    d.getMinutes(),
  )}분 ${padZero(d.getSeconds())}초`;
}

// Applies a quick-button delta to a raw input value, clamped at zero.
export function clampedAmountAfterDelta(rawValue, delta) {
  const current = parseFloat(rawValue);
  const base = Number.isFinite(current) && current > 0 ? current : 0;
  return Math.max(0, base + delta);
}

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    const msg = (data && data.error) || "요청에 실패했습니다.";
    throw new Error(msg);
  }
  return data;
}

export async function getCurrency() {
  const settings = await api("/api/settings");
  return (settings && settings.currency) || "";
}

export function escapeHtml(s) {
  if (!s) return "";
  return s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) {
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.className =
    "fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-white z-50 " +
    (isError ? "bg-red-500" : "bg-teal-600");
  setTimeout(() => {
    t.className = "hidden";
  }, 2500);
}

export function dispatchAppEvent(name, detail = {}) {
  document.dispatchEvent(new CustomEvent(name, { detail }));
}
