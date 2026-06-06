import { EVENTS, api, dispatchAppEvent, fmtCurrency, getCurrency, showToast } from "./helper.js";

let goalInitialized = false;
let goalCurrency = "KRW";

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

  try {
    const currency = await getCurrency();
    if (!currency) return;
    goalCurrency = currency;
    await loadCurrentGoal();
  } catch (e) {
    renderGoalError(e.message);
  }
}

function formatMonthLabel(ym) {
  if (!ym) return "-";
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

function formatSavedAt(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}월 ${p(d.getDate())}일 ${p(d.getHours())}:${p(d.getMinutes())} 저장`;
}

async function loadCurrentGoal() {
  const data = await api("/api/expense-goals");
  renderGoal(data);
}

function renderGoal(data) {
  const monthLabel = document.getElementById("goal-month-label");
  const amountEl = document.getElementById("goal-current-amount");
  const noteEl = document.getElementById("goal-current-note");
  const amountInput = document.getElementById("goal-amount");
  const goal = data && data.goal;

  if (monthLabel) {
    monthLabel.textContent = formatMonthLabel(data && data.month);
  }

  if (!goal) {
    if (amountEl) amountEl.textContent = "목표 미설정";
    if (noteEl) noteEl.textContent = "목표를 입력해 주세요";
    if (amountInput) amountInput.value = "";
    return;
  }

  if (amountEl) {
    amountEl.textContent = fmtCurrency(goal.amount, goalCurrency);
  }
  if (noteEl) {
    noteEl.textContent = formatSavedAt(goal.created_at);
  }
  if (amountInput) {
    amountInput.value = Number.isInteger(goal.amount) ? String(goal.amount) : String(goal.amount.toFixed(2));
  }
}

function renderGoalError(message) {
  const noteEl = document.getElementById("goal-current-note");
  if (noteEl) {
    noteEl.textContent = message || "목표를 불러오지 못했습니다.";
  }
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
