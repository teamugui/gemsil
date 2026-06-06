// Pure HTML-builder functions for the dashboard expense list. Each returns a
// markup string and performs no DOM access or mutation, so it stays trivially
// testable and keeps the controller (dashboard-component.js) focused on wiring.
import {
  CATEGORY,
  PAYMENT_LABELS,
  PAYMENT_TYPES,
  escapeHtml,
  formatAmountValue,
  formatCurrency,
  formatTimestampFull,
  formatTimestampShort,
} from "./helper.js";

export function recurringEndButtonLabel(paymentType) {
  if (paymentType === PAYMENT_TYPES.annual) return "연간결제종료";
  return "월간결제종료";
}

export function expenseItemHtml(it, currency, editingId) {
  const badge =
    it.category === CATEGORY.fixed
      ? `<span class="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">고정</span>`
      : `<span class="text-xs px-2 py-0.5 rounded-full bg-sky-100 text-sky-700">변동</span>`;
  const typeLabel = PAYMENT_LABELS[it.payment_type] || it.payment_type;
  let amountHtml = `<span class="font-semibold">${formatCurrency(it.amount, currency)}</span>`;
  if (it.payment_type === PAYMENT_TYPES.annual && it.full_amount) {
    amountHtml += `<div class="text-xs text-gray-400">연 ${formatCurrency(
      it.full_amount,
      currency,
    )} ÷ 12</div>`;
  }
  const merchant = it.merchant
    ? `<div class="font-medium truncate">${escapeHtml(it.merchant)}</div>`
    : `<div class="font-medium truncate text-gray-400">입력되지 않은 지출처</div>`;
  const desc = it.description
    ? `<div class="text-sm text-gray-500 truncate">${escapeHtml(it.description)}</div>`
    : "";
  const editForm = it.id === editingId ? editFormHtml(it, currency) : "";
  return `
        <div data-component-id="expense.dashboard.item" data-expense-id="${it.id}">
          <div class="bg-white rounded-2xl shadow-sm p-5">
            <div class="flex items-center justify-between">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-0.5">
                  ${badge}
                  <span class="text-xs text-gray-400">${typeLabel}</span>
                </div>
                ${merchant}
                ${desc}
                <div class="flex items-center gap-1 text-xs text-gray-400${
                  it.description ? " mt-1" : ""
                }">
                  <span title="${formatTimestampFull(it.created_at)}">${formatTimestampShort(
                    it.created_at,
                  )}</span>
                  <button
                    type="button"
                    data-edit-expense="${it.id}"
                    class="rounded px-1 text-gray-400 hover:bg-gray-100 hover:text-teal-600"
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
}

export function editFormHtml(it, currency) {
  const amount = it.full_amount || it.amount;
  const amountValue = formatAmountValue(amount);
  const isChecked = (type) => (it.payment_type === type ? " checked" : "");
  const amountQuickButtons =
    currency === "KRW"
      ? `
        <div data-component-id="expense.dashboard.edit-amount-quick-buttons" data-edit-amount-quick-buttons="${it.id}" class="hidden col-span-2 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          <button type="button" data-edit-amount-delta="1000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">+1,000</button>
          <button type="button" data-edit-amount-delta="10000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">+10,000</button>
          <button type="button" data-edit-amount-delta="50000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700">+50,000</button>
          <button type="button" data-edit-amount-delta="-1000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-1,000</button>
          <button type="button" data-edit-amount-delta="-10000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-10,000</button>
          <button type="button" data-edit-amount-delta="-50000" class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700">-50,000</button>
        </div>`
      : "";
  return `
    <form data-component-id="expense.dashboard.edit-form" data-edit-form="${it.id}" class="mt-2 bg-gray-50 border border-gray-200 rounded-2xl p-5 space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="block text-sm font-medium mb-1">
            지출액 (<span>${escapeHtml(currency)}</span>)
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
            class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1">지출처</label>
          <input
            id="edit-merchant-${it.id}"
            type="text"
            value="${escapeHtml(it.merchant)}"
            placeholder="어디에 썼습니까"
            class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
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
          class="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-400"
        />
      </div>
      <div>
        <label class="block text-sm font-medium mb-1">결제 유형</label>
        <div data-component-id="expense.dashboard.edit-payment-type" class="grid grid-cols-3 gap-2" data-edit-payment-type-group="${it.id}">
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="once"${isChecked("once")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
              일회성
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="monthly"${isChecked("monthly")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
              월간
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="annual"${isChecked("annual")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
              연간
            </span>
          </label>
        </div>
      </div>
      ${actionRowHtml(it)}
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

export function actionRowHtml(it) {
  const fixedControls = fixedControlsHtml(it);
  const submitButton = `
    <button
      type="submit"
      class="w-full bg-teal-600 hover:bg-teal-700 text-white font-semibold py-2.5 rounded-lg transition"
    >
      수정
    </button>`;

  if (!fixedControls) return submitButton;
  const rowCols = it.payment_type === PAYMENT_TYPES.once ? "grid-cols-1" : "grid-cols-2";
  return `
    <div data-component-id="expense.dashboard.recurring-action-row" data-recurring-action-row="${it.id}" class="grid ${rowCols} gap-2">
      ${fixedControls}
      ${submitButton}
    </div>`;
}

export function fixedControlsHtml(it) {
  if (it.category !== CATEGORY.fixed) return "";
  const hidden = it.payment_type === PAYMENT_TYPES.once ? " hidden" : "";
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
