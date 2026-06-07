import {
  EVENTS,
  api,
  dispatchAppEvent,
  formatAmountValue,
  formatCurrency,
  getCurrency,
  showToast,
} from "./helper.js";

let goalInitialized = false;
let goalCurrency = "KRW";
let currentGoalAmount = null;

export async function initGoalComponent() {
  if (goalInitialized) return;
  goalInitialized = true;

  document.addEventListener(EVENTS.currencyChanged, (e) => {
    goalCurrency = e.detail.currency || goalCurrency;
    loadCurrentGoal();
  });

  const form = document.getElementById("goal-form");
  if (form) {
    form.addEventListener("submit", handleGoalSubmit);
  }

  setupGoalToggle();

  try {
    const currency = await getCurrency();
    if (!currency) return;
    goalCurrency = currency;
    await loadCurrentGoal();
  } catch (e) {
    renderGoalError(e.message);
  }
}

function setupGoalToggle() {
  const toggle = document.getElementById("goal-toggle");
  const form = document.getElementById("goal-form");
  const toggleIcon = document.getElementById("goal-toggle-icon");
  if (!toggle || !form || !toggleIcon) return;

  function setGoalFormOpen(isOpen) {
    form.style.maxHeight = isOpen ? `${form.scrollHeight}px` : "0";
    form.style.opacity = isOpen ? "1" : "0";
    form.style.marginTop = isOpen ? "1rem" : "0";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    toggleIcon.textContent = isOpen ? "▼" : "▶";
  }

  toggle.addEventListener("click", () => {
    setGoalFormOpen(toggle.getAttribute("aria-expanded") !== "true");
  });
}

async function loadCurrentGoal() {
  const data = await api("/api/expense-goals");
  renderGoal(data);
}

function renderGoal(data) {
  const amountEl = document.getElementById("goal-current-amount");
  const amountInput = document.getElementById("goal-amount");
  const goal = data && data.goal;

  if (!goal) {
    currentGoalAmount = null;
    if (amountEl) amountEl.textContent = "목표 미설정";
    if (amountInput) amountInput.value = "";
    return;
  }

  currentGoalAmount = goal.amount;
  if (amountEl) {
    amountEl.textContent = formatCurrency(goal.amount, goalCurrency);
  }
  if (amountInput) {
    amountInput.value = formatAmountValue(goal.amount);
  }
}

function renderGoalError(message) {
  showToast(message || "목표를 불러오지 못했습니다.", true);
}

async function handleGoalSubmit(e) {
  e.preventDefault();
  const amountInput = document.getElementById("goal-amount");
  const amount = parseFloat(amountInput && amountInput.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("목표 금액을 입력하세요.", true);
    if (amountInput) amountInput.focus();
    return;
  }
  if (currentGoalAmount !== null && amount === currentGoalAmount) {
    showToast("변경된 내용이 없습니다.", true);
    return;
  }

  try {
    const goal = await api("/api/expense-goals", {
      method: "POST",
      body: JSON.stringify({ amount }),
    });
    renderGoal({ month: goal.month, goal });
    showToast("지출목표가 저장되었습니다.");
    dispatchAppEvent(EVENTS.goalChanged);
  } catch (err) {
    showToast(err.message, true);
  }
}
