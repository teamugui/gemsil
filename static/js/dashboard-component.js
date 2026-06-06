import {
  EVENTS,
  PAYMENT_TYPES,
  api,
  clampedAmountAfterDelta,
  escapeHtml,
  formatCurrency,
  formatMonthLabel,
  showToast,
} from "./helper.js";
import { expenseItemHtml, recurringEndButtonLabel } from "./dashboard-templates.js";

let dashboardItems = [];
let dashboardCurrency = "KRW";
let dashboardFilter = "all";
let dashboardEditingID = null;
let dashboardInitialized = false;

export async function initDashboardComponent() {
  if (dashboardInitialized) return;
  dashboardInitialized = true;

  document.addEventListener(EVENTS.currencyChanged, () => loadDashboard(selectedDashboardMonth()));
  document.addEventListener(EVENTS.expenseChanged, () => loadDashboard(selectedDashboardMonth()));
  document.addEventListener(EVENTS.goalChanged, () => loadDashboard(selectedDashboardMonth()));

  await loadDashboard();

  const sel = document.getElementById("month-select");
  if (sel) {
    sel.addEventListener("change", () => loadDashboard(sel.value));
  }

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((b) => {
        b.classList.remove("bg-teal-600", "text-white");
      });
      btn.classList.add("bg-teal-600", "text-white");
      dashboardFilter = btn.getAttribute("data-filter");
      renderItems(dashboardFilter);
    });
  });

  const list = document.getElementById("expense-list");
  if (list) {
    list.addEventListener("click", handleDashboardListClick);
    list.addEventListener("mousedown", handleDashboardListMouseDown);
    list.addEventListener("focusin", handleDashboardListFocusIn);
    list.addEventListener("focusout", handleDashboardListFocusOut);
    list.addEventListener("change", handleDashboardListChange);
    list.addEventListener("submit", handleDashboardEditSubmit);
  }
}

function selectedDashboardMonth() {
  const sel = document.getElementById("month-select");
  return sel ? sel.value : "";
}

async function loadDashboard(month) {
  const list = document.getElementById("expense-list");
  try {
    const qs = month ? `?month=${encodeURIComponent(month)}` : "";
    const data = await api(`/api/dashboard${qs}`);
    dashboardCurrency = data.currency || "KRW";
    dashboardItems = data.items || [];

    const sel = document.getElementById("month-select");
    if (sel) {
      sel.innerHTML = (data.months || [])
        .map(
          (m) =>
            `<option value="${m}"${m === data.month ? " selected" : ""}>${formatMonthLabel(m)}</option>`,
        )
        .join("");
    }

    document.getElementById("fixed-amount").textContent = formatCurrency(
      data.fixed,
      dashboardCurrency,
    );
    document.getElementById("variable-amount").textContent = formatCurrency(
      data.variable,
      dashboardCurrency,
    );
    document.getElementById("total-amount").textContent = formatCurrency(
      data.total,
      dashboardCurrency,
    );
    renderGoalSummary(data);
    renderItems(dashboardFilter);
  } catch (e) {
    if (list) {
      list.innerHTML = `<p class="text-red-500 p-4 text-center">${escapeHtml(e.message)}</p>`;
    }
  }
}

function renderGoalSummary(data) {
  const goalEl = document.getElementById("goal-summary");
  if (!goalEl) return;

  if (data.goal_amount === null || data.goal_amount === undefined) {
    goalEl.textContent = "목표 미설정";
    goalEl.className = "basis-full text-center text-xs font-medium text-gray-400";
    return;
  }

  const remaining = Number(data.remaining_amount);
  const usageRate = Number(data.goal_usage_rate);
  const usageText = Number.isFinite(usageRate) ? `${Math.round(usageRate * 100)}%` : "-";
  goalEl.textContent = `목표 ${formatCurrency(data.goal_amount, dashboardCurrency)} · 잔여 ${formatCurrency(
    remaining,
    dashboardCurrency,
  )} · 사용률 ${usageText}`;
  goalEl.className =
    "basis-full text-center text-xs font-medium " +
    (remaining >= 0 ? "text-teal-600" : "text-red-500");
}

function renderItems(filter) {
  const list = document.getElementById("expense-list");
  if (!list) return;

  let items = dashboardItems;
  if (filter && filter !== "all") {
    items = items.filter((it) => it.payment_type === filter);
  }
  if (items.length === 0) {
    list.innerHTML = `<p class="text-gray-400 text-center py-10">표시할 지출이 없습니다.</p>`;
    return;
  }
  list.innerHTML = items
    .map((it) => expenseItemHtml(it, dashboardCurrency, dashboardEditingID))
    .join("");
}

function updateDashboardRecurringControls(form) {
  const controls = form.querySelector("[data-recurring-controls]");
  if (!controls) return;
  const row = form.querySelector("[data-recurring-action-row]");

  const id = form.getAttribute("data-edit-form");
  const selected = form.querySelector(`input[name="edit-payment-type-${id}"]:checked`);
  const paymentType = selected ? selected.value : PAYMENT_TYPES.once;
  const isOnce = paymentType === PAYMENT_TYPES.once;
  controls.classList.toggle("hidden", isOnce);
  if (row) {
    row.classList.toggle("grid-cols-2", !isOnce);
    row.classList.toggle("grid-cols-1", isOnce);
  }

  if (controls.matches("[data-end-recurring]")) {
    controls.textContent = recurringEndButtonLabel(paymentType);
  }
}

function setDashboardEditAmountQuickVisible(form, isVisible) {
  if (!form || dashboardCurrency !== "KRW") return;
  const buttons = form.querySelector("[data-edit-amount-quick-buttons]");
  if (buttons) {
    buttons.classList.toggle("hidden", !isVisible);
  }
}

function shouldShowDashboardEditAmountQuick(form, target) {
  if (!form || !target || !target.closest) return false;
  return (
    Boolean(target.closest("[data-edit-amount-input]")) ||
    Boolean(target.closest("[data-edit-amount-quick-buttons]"))
  );
}

function handleDashboardListMouseDown(e) {
  if (e.target.closest("[data-edit-amount-delta]")) {
    e.preventDefault();
  }
}

function handleDashboardListFocusIn(e) {
  const form = e.target.closest("[data-edit-form]");
  if (!form) return;
  setDashboardEditAmountQuickVisible(form, shouldShowDashboardEditAmountQuick(form, e.target));
}

function handleDashboardListFocusOut(e) {
  const form = e.target.closest("[data-edit-form]");
  if (!form) return;

  setTimeout(() => {
    const activeEl = document.activeElement;
    setDashboardEditAmountQuickVisible(form, shouldShowDashboardEditAmountQuick(form, activeEl));
  }, 0);
}

function handleDashboardListChange(e) {
  if (!e.target.matches("[data-edit-payment-type-group] input[type='radio']")) return;
  const form = e.target.closest("[data-edit-form]");
  if (form) updateDashboardRecurringControls(form);
}

function handleDashboardListClick(e) {
  const paymentTypeInput = e.target.closest("[data-edit-payment-type-group] input[type='radio']");
  if (paymentTypeInput) {
    const form = paymentTypeInput.closest("[data-edit-form]");
    if (form) updateDashboardRecurringControls(form);
    return;
  }

  const deltaBtn = e.target.closest("[data-edit-amount-delta]");
  if (deltaBtn) {
    const form = deltaBtn.closest("[data-edit-form]");
    if (!form) return;
    const id = parseInt(form.getAttribute("data-edit-form"), 10);
    const amountInput = document.getElementById(`edit-amount-${id}`);
    const delta = parseFloat(deltaBtn.getAttribute("data-edit-amount-delta"));
    amountInput.value = String(clampedAmountAfterDelta(amountInput.value, delta));
    amountInput.focus();
    setDashboardEditAmountQuickVisible(form, true);
    return;
  }

  const editBtn = e.target.closest("[data-edit-expense]");
  if (editBtn) {
    dashboardEditingID = parseInt(editBtn.getAttribute("data-edit-expense"), 10);
    renderItems(dashboardFilter);
    const amount = document.getElementById(`edit-amount-${dashboardEditingID}`);
    if (amount) amount.focus();
    return;
  }

  const cancelBtn = e.target.closest("[data-cancel-edit]");
  if (cancelBtn) {
    dashboardEditingID = null;
    renderItems(dashboardFilter);
    return;
  }

  const endBtn = e.target.closest("[data-end-recurring]");
  if (endBtn) {
    endDashboardRecurring(parseInt(endBtn.getAttribute("data-end-recurring"), 10), false);
    return;
  }

  const resumeBtn = e.target.closest("[data-resume-recurring]");
  if (resumeBtn) {
    endDashboardRecurring(parseInt(resumeBtn.getAttribute("data-resume-recurring"), 10), true);
    return;
  }

  const deleteBtn = e.target.closest("[data-delete-expense]");
  if (deleteBtn) {
    deleteDashboardExpense(parseInt(deleteBtn.getAttribute("data-delete-expense"), 10));
  }
}

async function handleDashboardEditSubmit(e) {
  const form = e.target.closest("[data-edit-form]");
  if (!form) return;
  e.preventDefault();

  const id = parseInt(form.getAttribute("data-edit-form"), 10);
  const amount = parseFloat(document.getElementById(`edit-amount-${id}`).value);
  if (!amount || amount <= 0) {
    showToast("금액을 입력하세요.", true);
    return;
  }

  const payload = {
    amount: amount,
    merchant: document.getElementById(`edit-merchant-${id}`).value.trim(),
    description: document.getElementById(`edit-description-${id}`).value.trim(),
    payment_type: form.querySelector(`input[name="edit-payment-type-${id}"]:checked`).value,
  };

  try {
    await api(`/api/expenses/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
    dashboardEditingID = null;
    await loadDashboard(selectedDashboardMonth());
    showToast("수정되었습니다.");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function endDashboardRecurring(id, resume) {
  const it = dashboardItems.find((x) => x.id === id);
  if (!it) return;
  const selectedMonth = selectedDashboardMonth();
  const endMonth =
    it.payment_type === PAYMENT_TYPES.annual ? `${selectedMonth.slice(0, 4)}-12` : selectedMonth;

  try {
    await api(`/api/expenses/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        amount: it.full_amount || it.amount,
        merchant: it.merchant,
        description: it.description,
        payment_type: it.payment_type,
        end_month: resume ? "" : endMonth,
      }),
    });
    dashboardEditingID = null;
    await loadDashboard(selectedDashboardMonth());
    showToast(resume ? "정기결제를 재개했습니다." : recurringEndToast(it.payment_type));
  } catch (err) {
    showToast(err.message, true);
  }
}

function recurringEndToast(paymentType) {
  if (paymentType === PAYMENT_TYPES.annual) return "올해까지만 청구되도록 종료했습니다.";
  return "이 달까지만 청구되도록 종료했습니다.";
}

async function deleteDashboardExpense(id) {
  if (!confirm("이 지출 내역을 삭제하시겠습니까?")) return;

  try {
    await api(`/api/expenses/${id}`, { method: "DELETE" });
    dashboardEditingID = null;
    await loadDashboard(selectedDashboardMonth());
    showToast("삭제되었습니다.");
  } catch (err) {
    showToast(err.message, true);
  }
}
