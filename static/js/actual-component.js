import {
  EVENTS,
  api,
  dispatchAppEvent,
  formatAmountValue,
  formatCurrency,
  getCurrency,
  showToast,
} from "./helper.js";

let actualInitialized = false;
let actualCurrency = "KRW";
let currentActualAmount = null;

export async function initActualComponent() {
  if (actualInitialized) return;
  actualInitialized = true;

  document.addEventListener(EVENTS.currencyChanged, (e) => {
    actualCurrency = e.detail.currency || actualCurrency;
    loadCurrentActual();
  });

  const form = document.getElementById("actual-form");
  if (form) {
    form.addEventListener("submit", handleActualSubmit);
  }

  setupActualToggle();

  try {
    const currency = await getCurrency();
    if (!currency) return;
    actualCurrency = currency;
    await loadCurrentActual();
  } catch (e) {
    renderActualError(e.message);
  }
}

function setupActualToggle() {
  const toggle = document.getElementById("actual-toggle");
  const form = document.getElementById("actual-form");
  const toggleIcon = document.getElementById("actual-toggle-icon");
  if (!toggle || !form || !toggleIcon) return;

  function setActualFormOpen(isOpen) {
    form.style.maxHeight = isOpen ? `${form.scrollHeight}px` : "0";
    form.style.opacity = isOpen ? "1" : "0";
    form.style.marginTop = isOpen ? "1rem" : "0";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggleIcon.textContent = isOpen ? "▼" : "▶";
  }

  toggle.addEventListener("click", () => {
    setActualFormOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
}

async function loadCurrentActual() {
  const data = await api("/api/actual-expenses");
  renderActual(data);
}

function renderActual(data) {
  const amountEl = document.getElementById("actual-current-amount");
  const amountInput = document.getElementById("actual-amount");
  const actual = data && data.actual;

  if (!actual) {
    currentActualAmount = null;
    if (amountEl) amountEl.textContent = "미입력";
    if (amountInput) amountInput.value = "";
  } else {
    currentActualAmount = actual.amount;
    if (amountEl) {
      amountEl.textContent = formatCurrency(actual.amount, actualCurrency);
    }
    if (amountInput) {
      amountInput.value = formatAmountValue(actual.amount);
    }
  }

  const titleLabel = document.getElementById("actual-title-label");
  if (titleLabel && data && data.month) {
    const monthNum = parseInt(data.month.split("-")[1], 10);
    titleLabel.textContent = `${monthNum}월의 실제 지출액`;
  }


}

function renderActualError(message) {
  showToast(message || "실제 지출액을 불러오지 못했습니다.", true);
}

async function handleActualSubmit(e) {
  e.preventDefault();
  const amountInput = document.getElementById("actual-amount");
  const amount = parseFloat(amountInput && amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("금액을 입력하세요.", true);
    if (amountInput) amountInput.focus();
    return;
  }
  if (currentActualAmount !== null && amount === currentActualAmount) {
    showToast("변경된 내용이 없습니다.", true);
    return;
  }

  try {
    const actual = await api("/api/actual-expenses", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    renderActual({ month: actual.month, actual });
    showToast("실제 지출액이 저장되었습니다.");
    dispatchAppEvent(EVENTS.actualChanged);
  } catch (err) {
    showToast(err.message, true);
  }
}
