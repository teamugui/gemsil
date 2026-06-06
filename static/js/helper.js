export const PAYMENT_LABELS = { once: "일회성", monthly: "월간", annual: "연간" };
export const CURRENCY_LOCALE = { KRW: "ko-KR", JPY: "ja-JP" };

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
};

export function fmtCurrency(n, currency) {
  const cur = currency || "KRW";
  const locale = CURRENCY_LOCALE[cur] || "ko-KR";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(Math.round(n));
  } catch (e) {
    return Math.round(n).toLocaleString() + " " + cur;
  }
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
    } catch (e) {
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
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
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
