import { EVENTS, PAYMENT_LABELS, api, escapeHtml, fmtCurrency, showToast } from "./helper.js";

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

  await loadDashboard();

  const sel = document.getElementById("month-select");
  if (sel) {
    sel.addEventListener("change", () => loadDashboard(sel.value));
  }

  document.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("[data-filter]").forEach((b) => {
        b.classList.remove("bg-indigo-600", "text-white");
      });
      btn.classList.add("bg-indigo-600", "text-white");
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

function formatMonthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

function fmtCreatedAt(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return escapeHtml(s || "");
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}일 ${p(d.getHours())}시`;
}

function fmtCreatedAtFull(s) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return escapeHtml(s || "");
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}월 ${p(d.getDate())}일 ${p(d.getHours())}시 ${p(
    d.getMinutes()
  )}분 ${p(d.getSeconds())}초`;
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
        .map((m) => `<option value="${m}"${m === data.month ? " selected" : ""}>${formatMonthLabel(m)}</option>`)
        .join("");
    }

    document.getElementById("fixed-amount").textContent = fmtCurrency(data.fixed, dashboardCurrency);
    document.getElementById("variable-amount").textContent = fmtCurrency(data.variable, dashboardCurrency);
    document.getElementById("total-amount").textContent = fmtCurrency(data.total, dashboardCurrency);
    renderItems(dashboardFilter);
  } catch (e) {
    if (list) {
      list.innerHTML = `<p class="text-red-500 p-4 text-center">${escapeHtml(e.message)}</p>`;
    }
  }
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
    .map((it) => {
      const badge =
        it.category === "fixed"
          ? `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">고정</span>`
          : `<span class="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">변동</span>`;
      const typeLabel = PAYMENT_LABELS[it.payment_type] || it.payment_type;
      let amountHtml = `<span class="font-semibold">${fmtCurrency(it.amount, dashboardCurrency)}</span>`;
      if (it.payment_type === "annual" && it.full_amount) {
        amountHtml += `<div class="text-xs text-gray-400">연 ${fmtCurrency(
          it.full_amount,
          dashboardCurrency
        )} ÷ 12</div>`;
      }
      const merchant = it.merchant
        ? `<div class="font-medium truncate">${escapeHtml(it.merchant)}</div>`
        : `<div class="font-medium truncate text-gray-400">입력되지 않은 지출처</div>`;
      const desc = it.description ? `<div class="text-sm text-gray-500 truncate">${escapeHtml(it.description)}</div>` : "";
      const editForm = it.id === dashboardEditingID ? renderDashboardEditForm(it) : "";
      return `
        <div>
          <div class="bg-white rounded-2xl shadow-sm p-5">
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  ${badge}
                  <span class="text-xs text-gray-400">${typeLabel}</span>
                </div>
                ${merchant}
                ${desc}
                <div class="flex items-center gap-1 text-xs text-gray-400${it.description ? " mt-1" : ""}">
                  <span title="${fmtCreatedAtFull(it.created_at)}">${fmtCreatedAt(it.created_at)}</span>
                  <button
                    type="button"
                    data-edit-expense="${it.id}"
                    class="rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600"
                    aria-label="지출 내역 수정"
                    title="수정"
                  >
                    ✎
                  </button>
                </div>
              </div>
              <div class="text-right shrink-0 pl-3">${amountHtml}</div>
            </div>
          </div>
          ${editForm}
        </div>`;
    })
    .join("");
}

function renderDashboardEditForm(it) {
  const amount = it.full_amount || it.amount;
  const amountValue = Number.isInteger(amount) ? String(amount) : String(amount.toFixed(2));
  const isChecked = (type) => (it.payment_type === type ? " checked" : "");
  const amountQuickButtons =
    dashboardCurrency === "KRW"
      ? `
        <div data-edit-amount-quick-buttons="${it.id}" class="hidden col-span-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <button type="button" data-edit-amount-delta="1000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">+1,000</button>
          <button type="button" data-edit-amount-delta="10000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">+10,000</button>
          <button type="button" data-edit-amount-delta="50000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700">+50,000</button>
          <button type="button" data-edit-amount-delta="-1000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-1,000</button>
          <button type="button" data-edit-amount-delta="-10000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-10,000</button>
          <button type="button" data-edit-amount-delta="-50000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-50,000</button>
        </div>`
      : "";
  return `
    <form data-edit-form="${it.id}" class="mt-2 bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium mb-1">
            지출액 (<span>${escapeHtml(dashboardCurrency)}</span>)
          </label>
          <input
            id="edit-amount-${it.id}"
            type="number"
            step="any"
            min="0"
            inputmode="decimal"
            required
            value="${escapeHtml(amountValue)}"
            placeholder="얼마를 썼습니까"
            data-edit-amount-input="${it.id}"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">지출처</label>
          <input
            id="edit-merchant-${it.id}"
            type="text"
            value="${escapeHtml(it.merchant)}"
            placeholder="어디에 썼습니까"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
        </div>
        ${amountQuickButtons}
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">지출 내용</label>
        <input
          id="edit-description-${it.id}"
          type="text"
          value="${escapeHtml(it.description)}"
          placeholder="설명을 해주세요"
          class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">결제 유형</label>
        <div class="grid grid-cols-3 gap-2" data-edit-payment-type-group="${it.id}">
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="once"${isChecked("once")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              일회성
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="monthly"${isChecked("monthly")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              월간
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="annual"${isChecked("annual")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              연간
            </span>
          </label>
        </div>
      </div>
      ${renderDashboardActionRow(it)}
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          data-cancel-edit="${it.id}"
          class="border border-gray-300 text-gray-600 font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition"
        >
          취소
        </button>
        <button
          type="button"
          data-delete-expense="${it.id}"
          class="border border-red-300 text-red-600 font-semibold py-2.5 rounded-lg hover:bg-red-50 transition"
        >
          삭제
        </button>
      </div>
    </form>`;
}

function renderDashboardActionRow(it) {
  const fixedControls = renderDashboardFixedControls(it);
  const submitButton = `
    <button
      type="submit"
      class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition"
    >
      수정
    </button>`;

  if (!fixedControls) return submitButton;
  const rowCols = it.payment_type === "once" ? "grid-cols-1" : "grid-cols-2";
  return `
    <div data-recurring-action-row="${it.id}" class="grid ${rowCols} gap-2">
      ${fixedControls}
      ${submitButton}
    </div>`;
}

function renderDashboardFixedControls(it) {
  if (it.category !== "fixed") return "";
  const hidden = it.payment_type === "once" ? " hidden" : "";
  if (it.end_month) {
    return `
      <button
        type="button"
        data-resume-recurring="${it.id}"
        data-recurring-controls="${it.id}"
        class="w-full border border-gray-300 text-gray-600 font-semibold py-2.5 rounded-lg hover:bg-gray-50 transition${hidden}"
      >
        정기결제 재개 (계속 청구)
      </button>`;
  }
  return `
    <button
      type="button"
      data-end-recurring="${it.id}"
      data-recurring-controls="${it.id}"
      class="w-full border border-amber-400 text-amber-700 font-semibold py-2.5 rounded-lg hover:bg-amber-50 transition${hidden}"
    >
      ${recurringEndButtonLabel(it.payment_type)}
    </button>`;
}

function recurringEndButtonLabel(paymentType) {
  if (paymentType === "annual") return "연간결제종료";
  return "월간결제종료";
}

function updateDashboardRecurringControls(form) {
  const controls = form.querySelector("[data-recurring-controls]");
  if (!controls) return;
  const row = form.querySelector("[data-recurring-action-row]");

  const id = form.getAttribute("data-edit-form");
  const selected = form.querySelector(`input[name="edit-payment-type-${id}"]:checked`);
  const paymentType = selected ? selected.value : "once";
  const isOnce = paymentType === "once";
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
    const amount = parseFloat(amountInput.value);
    const currentAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
    const delta = parseFloat(deltaBtn.getAttribute("data-edit-amount-delta"));
    amountInput.value = String(Math.max(0, currentAmount + delta));
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
  const endMonth = it.payment_type === "annual" ? `${selectedMonth.slice(0, 4)}-12` : selectedMonth;

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
  if (paymentType === "annual") return "올해까지만 청구되도록 종료했습니다.";
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
