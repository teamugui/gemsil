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

// Rounds a 0..1 rate to a whole-number percent for labels (uncapped, so an
// over-budget ratio reads e.g. "120%").
function ratePercent(rate) {
  return Number.isFinite(rate) ? Math.round(rate * 100) : 0;
}

// Clamps a 0..1 rate to a 0..100 bar width so an over-budget fill stops at 100%.
function clampWidth(rate) {
  if (!Number.isFinite(rate)) return 0;
  return Math.max(0, Math.min(100, rate * 100));
}

function isSet(v) {
  return v !== null && v !== undefined;
}

// One labelled single-fill progress row (used by the goal and actual bars).
function progressRowHtml({ name, rateLabel, rateClass, widthPct, fillClass, subHtml }) {
  return `
    <div>
      <div class="flex items-baseline justify-between mb-1">
        <span class="text-sm font-medium text-gray-700">${name}</span>
        <span class="text-sm font-medium ${rateClass}">${rateLabel}</span>
      </div>
      <div class="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div class="h-full rounded-full ${fillClass} transition-all duration-300" style="width: ${widthPct}%"></div>
      </div>
      ${subHtml ? `<div class="mt-1 text-xs text-gray-500">${subHtml}</div>` : ""}
    </div>`;
}

// Bar 1 — planned total (fixed + variable) against the month's goal. Empty
// portion of the track is the remaining budget; over-budget turns red.
function goalTotalBarHtml(data, currency) {
  const totalText = formatCurrency(Number(data.total) || 0, currency);
  if (!isSet(data.goal_amount)) {
    return progressRowHtml({
      name: "합계 / 목표",
      rateLabel: "목표 미설정",
      rateClass: "text-gray-400",
      widthPct: 0,
      fillClass: "bg-teal-500",
      subHtml: `합계 ${totalText}`,
    });
  }
  const rate = Number(data.goal_usage_rate);
  const over = rate > 1;
  const remaining = Number(data.remaining_amount);
  const remClass = remaining < 0 ? "text-red-500" : "text-gray-700";
  return progressRowHtml({
    name: "합계 / 목표",
    rateLabel: `${ratePercent(rate)}%`,
    rateClass: over ? "text-red-500" : "text-teal-600",
    widthPct: clampWidth(rate),
    fillClass: over ? "bg-red-500" : "bg-teal-500",
    subHtml: `합계 ${totalText} · 잔여 <span class="${remClass}">${formatCurrency(remaining, currency)}</span>`,
  });
}

// Bar 2 — actual reported spending against the month's goal.
function actualBarHtml(data, currency) {
  if (!isSet(data.actual_amount)) {
    return progressRowHtml({
      name: "실제 / 목표",
      rateLabel: "미입력",
      rateClass: "text-gray-400",
      widthPct: 0,
      fillClass: "bg-violet-500",
      subHtml: "실제 지출 미입력",
    });
  }
  const actualText = formatCurrency(Number(data.actual_amount), currency);
  if (!isSet(data.goal_amount)) {
    return progressRowHtml({
      name: "실제 / 목표",
      rateLabel: "목표 미설정",
      rateClass: "text-gray-400",
      widthPct: 0,
      fillClass: "bg-violet-500",
      subHtml: `실제 ${actualText}`,
    });
  }
  const rate = Number(data.actual_usage_rate);
  const over = rate > 1;
  const remaining = Number(data.actual_remaining);
  const remClass = remaining < 0 ? "text-red-500" : "text-gray-700";
  return progressRowHtml({
    name: "실제 / 목표",
    rateLabel: `${ratePercent(rate)}%`,
    rateClass: over ? "text-red-500" : "text-violet-600",
    widthPct: clampWidth(rate),
    fillClass: over ? "bg-red-500" : "bg-violet-500",
    subHtml: `실제 ${actualText} · 잔여 <span class="${remClass}">${formatCurrency(remaining, currency)}</span>`,
  });
}

// Bar 3 — composition of the planned total as a stacked fixed/variable bar.
function compositionBarHtml(data, currency) {
  const fixed = Number(data.fixed) || 0;
  const variable = Number(data.variable) || 0;
  const total = fixed + variable;
  if (total <= 0) {
    return `
    <div>
      <div class="flex items-baseline justify-between mb-1">
        <span class="text-sm font-medium text-gray-700">고정 · 변동 구성</span>
        <span class="text-sm font-medium text-gray-400">지출 없음</span>
      </div>
      <div class="h-2.5 w-full rounded-full bg-gray-100"></div>
    </div>`;
  }
  const fixedPct = Math.round((fixed / total) * 100);
  const variablePct = 100 - fixedPct;
  return `
    <div>
      <div class="flex items-baseline justify-between mb-1">
        <span class="text-sm font-medium text-gray-700">고정 · 변동 구성</span>
        <span class="text-sm font-medium text-gray-900">${formatCurrency(total, currency)}</span>
      </div>
      <div class="flex h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
        <div class="h-full bg-amber-500" style="width: ${(fixed / total) * 100}%"></div>
        <div class="h-full bg-sky-500" style="width: ${(variable / total) * 100}%"></div>
      </div>
      <div class="mt-1 text-xs text-gray-500">
        <span class="text-amber-600">고정 ${formatCurrency(fixed, currency)} (${fixedPct}%)</span>
        · <span class="text-sky-600">변동 ${formatCurrency(variable, currency)} (${variablePct}%)</span>
      </div>
    </div>`;
}

// Sub-label for the coverage bar describing the reconciliation gap: positive
// untracked means money spent but never logged; negative means logged more than
// the reported actual. Empty when the two agree.
function untrackedText(untracked, currency) {
  const v = Number(untracked) || 0;
  if (v > 0) return ` · 누락 <span class="text-red-500">${formatCurrency(v, currency)}</span>`;
  if (v < 0)
    return ` · 초과 기록 <span class="text-gray-500">${formatCurrency(-v, currency)}</span>`;
  return "";
}

// Bar 4 — how much of the reported actual spending is covered by logged expenses
// (total / actual). The empty portion is money spent but never recorded. Hidden
// until an actual snapshot exists.
function coverageBarHtml(data, currency) {
  if (!isSet(data.actual_amount)) return "";
  const totalText = formatCurrency(Number(data.total) || 0, currency);
  const actualText = formatCurrency(Number(data.actual_amount) || 0, currency);
  const rate = Number(data.tracking_coverage);
  return progressRowHtml({
    name: "기록 커버리지",
    rateLabel: Number.isFinite(rate) ? `${ratePercent(rate)}%` : "—",
    rateClass: "text-emerald-600",
    widthPct: clampWidth(rate),
    fillClass: "bg-emerald-500",
    subHtml: `기록 ${totalText} / 실제 ${actualText}${untrackedText(data.untracked_amount, currency)}`,
  });
}

// A running Σ(goal − actual) from the earliest month through the viewed month:
// positive is cumulatively under budget, negative is over. Hidden until a month
// with both a goal and an actual snapshot exists.
function cumulativeSavingsHtml(data, currency) {
  if (!isSet(data.cumulative_savings)) return "";
  const v = Number(data.cumulative_savings) || 0;
  const saved = v >= 0;
  return `
    <div class="flex items-baseline justify-between border-t border-gray-100 pt-3">
      <span class="text-sm font-medium text-gray-700">${saved ? "이 달까지 누적 절약" : "이 달까지 누적 초과"}</span>
      <span class="text-sm font-semibold ${saved ? "text-emerald-600" : "text-red-500"}">${formatCurrency(
        Math.abs(v),
        currency,
      )}</span>
    </div>`;
}

// Builds the dashboard summary card: progress bars for planned total vs goal,
// actual vs goal, logged-vs-reported coverage, and the fixed/variable split, plus
// a cumulative savings line. Reconciliation rows hide themselves when their data
// is absent.
export function summaryHtml(data, currency) {
  return `
    <div class="bg-white rounded-2xl shadow-sm p-5 space-y-4">
      ${goalTotalBarHtml(data, currency)}
      ${actualBarHtml(data, currency)}
      ${coverageBarHtml(data, currency)}
      ${compositionBarHtml(data, currency)}
      ${cumulativeSavingsHtml(data, currency)}
    </div>`;
}

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
  let amountHtml = `<span class="font-medium">${formatCurrency(it.amount, currency)}</span>`;
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
            <span class="flex h-full items-center justify-center text-center text-sm font-medium py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
              일회성
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="monthly"${isChecked("monthly")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-medium py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
              월간
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="annual"${isChecked("annual")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-medium py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-teal-600 peer-checked:text-white peer-checked:border-teal-600">
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
          class="border border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition"
        >
          취소
        </button>
        <button
          type="button"
          data-delete-expense="${it.id}"
          class="border border-red-300 text-red-600 text-sm font-medium py-2.5 rounded-lg hover:bg-red-50 transition"
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
      class="w-full bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium py-2.5 rounded-lg transition"
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
        class="w-full border border-gray-300 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition${hidden}"
      >
        정기결제 재개 (계속 청구)
      </button>`;
  }
  return `
    <button
      type="button"
      data-end-recurring="${it.id}"
      data-recurring-controls="${it.id}"
      class="w-full border border-amber-400 text-amber-700 text-sm font-medium py-2.5 rounded-lg hover:bg-amber-50 transition${hidden}"
    >
      ${recurringEndButtonLabel(it.payment_type)}
    </button>`;
}
