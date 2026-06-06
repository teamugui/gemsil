// gemsil — shared frontend utilities used by both the input and dashboard pages.

const PAYMENT_LABELS = { once: "일회성", monthly: "월간결제", annual: "연간결제" };
const CURRENCY_LOCALE = { KRW: "ko-KR", JPY: "ja-JP" };

// Currencies offered in the exchange-rate calculator (the user's base currency
// is filtered out at render time).
const FX_CURRENCIES = [
  "USD", "EUR", "JPY", "KRW", "CNY", "GBP",
  "AUD", "CAD", "HKD", "SGD", "THB", "TWD",
];

// fmtCurrency formats a number in the user's base currency. KRW and JPY are
// both zero-decimal currencies.
function fmtCurrency(n, currency) {
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

// api is a small fetch wrapper that sends/parses JSON and throws on non-2xx,
// surfacing the server's Korean error message.
async function api(path, opts = {}) {
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

async function getCurrency() {
  const settings = await api("/api/settings");
  return (settings && settings.currency) || "";
}


function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showToast(msg, isError = false) {
  const t = document.getElementById("toast");
  if (!t) {
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.className =
    "fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-white z-50 " +
    (isError ? "bg-red-500" : "bg-green-600");
  setTimeout(() => {
    t.className = "hidden";
  }, 2500);
}

// ---------------------------------------------------------------------------
// Index page (currency setup + expense input + FX calculator)
// ---------------------------------------------------------------------------

async function initIndexPage() {
  const setupEl = document.getElementById("currency-setup");
  const appEl = document.getElementById("main-app");

  let currency = "";
  try {
    currency = await getCurrency();
  } catch (e) {
    /* treat as unset on failure */
  }

  if (!currency) {
    setupEl.classList.remove("hidden");
    appEl.classList.add("hidden");
    document.querySelectorAll("[data-currency-choice]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const chosen = btn.getAttribute("data-currency-choice");
        try {
          await api("/api/settings", {
            method: "POST",
            body: JSON.stringify({ currency: chosen }),
          });
          setupEl.classList.add("hidden");
          appEl.classList.remove("hidden");
          setupIndexApp(chosen);
        } catch (err) {
          alert(err.message);
        }
      });
    });
  } else {
    setupEl.classList.add("hidden");
    appEl.classList.remove("hidden");
    setupIndexApp(currency);
  }
}

function setupIndexApp(currency) {
  // Today's date in the page title (display only; the server is the source of truth).
  const titleEl = document.getElementById("entry-title");
  if (titleEl) {
    const now = new Date();
    titleEl.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 지출입력`;
  }

  // Show the base currency wherever it's referenced.
  document.querySelectorAll("[data-base-currency]").forEach((el) => {
    el.textContent = currency;
  });

  // Populate the FX currency dropdown, excluding the base currency.
  const fxSelect = document.getElementById("fx-currency");
  const fxFromCurrency = document.getElementById("fx-from-currency");

  function renderFxCurrencyLabel() {
    if (!fxFromCurrency || !fxSelect) return;
    fxFromCurrency.textContent = fxSelect.value || "";
  }

  if (fxSelect) {
    fxSelect.innerHTML = "";
    FX_CURRENCIES.filter((c) => c !== currency).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      fxSelect.appendChild(opt);
    });
    renderFxCurrencyLabel();
  }

  const optionalToggle = document.getElementById("optional-toggle");
  const optionalFields = document.getElementById("optional-fields");
  const optionalToggleIcon = document.getElementById("optional-toggle-icon");

  function setOptionalFieldsOpen(isOpen) {
    if (!optionalToggle || !optionalFields || !optionalToggleIcon) return;
    optionalFields.classList.toggle("hidden", !isOpen);
    optionalToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    optionalToggleIcon.textContent = isOpen ? "▼" : "▶";
  }

  if (optionalToggle) {
    optionalToggle.addEventListener("click", () => {
      setOptionalFieldsOpen(optionalToggle.getAttribute("aria-expanded") !== "true");
    });
  }

  const amountInput = document.getElementById("amount");
  const amountQuickButtons = document.getElementById("amount-quick-buttons");
  const isKrw = currency === "KRW";

  function setAmountQuickButtonsVisible(isVisible) {
    if (!amountQuickButtons) return;
    amountQuickButtons.classList.toggle("hidden", !isKrw || !isVisible);
  }

  function currentAmountValue() {
    const amount = parseFloat(amountInput.value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  if (amountInput && amountQuickButtons) {
    amountInput.addEventListener("focus", () => {
      setAmountQuickButtonsVisible(true);
    });

    document.addEventListener("focusin", (e) => {
      if (e.target !== amountInput && !amountQuickButtons.contains(e.target)) {
        setAmountQuickButtonsVisible(false);
      }
    });

    amountQuickButtons.querySelectorAll("[data-amount-quick-delta]").forEach((btn) => {
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
      });
      btn.addEventListener("click", () => {
        const delta = parseFloat(btn.getAttribute("data-amount-quick-delta"));
        const nextAmount = Math.max(0, currentAmountValue() + delta);
        amountInput.value = String(nextAmount);
        amountInput.focus();
        setAmountQuickButtonsVisible(true);
      });
    });
  }

  // Expense form submission.
  const form = document.getElementById("expense-form");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = parseFloat(amountInput.value);
    if (!amount || amount <= 0) {
      showToast("금액을 입력하세요.", true);
      return;
    }
    const payload = {
      amount: amount,
      merchant: document.getElementById("merchant").value.trim(),
      description: document.getElementById("description").value.trim(),
      payment_type: document.querySelector('input[name="payment_type"]:checked').value,
    };
    try {
      await api("/api/expenses", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("저장되었습니다.");
      form.reset();
      setAmountQuickButtonsVisible(false);
      document.querySelector('input[name="payment_type"][value="once"]').checked = true;
      setOptionalFieldsOpen(false);
      resetFxApplyButton();
    } catch (err) {
      showToast(err.message, true);
    }
  });

  // FX calculator panel toggle.
  const fxToggle = document.getElementById("fx-toggle");
  if (fxToggle) {
    fxToggle.addEventListener("click", () => {
      document.getElementById("fx-panel").classList.toggle("hidden");
    });
  }

  // FX calculation.
  const fxAmountInput = document.getElementById("fx-amount");
  const fxBtn = document.getElementById("fx-calc-btn");
  const fxApplyBtn = document.getElementById("fx-apply-btn");
  let fxApplyAmount = null;

  function resetFxApplyButton() {
    if (!fxApplyBtn || !fxAmountInput) return;
    const amount = parseFloat(fxAmountInput.value);
    fxApplyAmount = null;
    fxApplyBtn.disabled = true;
    fxApplyBtn.textContent =
      Number.isFinite(amount) && amount > 0
        ? "계산버튼을 눌러주세요"
        : "계산할 금액을 입력해주세요";
  }

  function setFxApplyButtonLoading() {
    if (!fxApplyBtn) return;
    fxApplyAmount = null;
    fxApplyBtn.disabled = true;
    fxApplyBtn.textContent = "계산 중...";
  }

  function setFxApplyButtonError(message) {
    if (!fxApplyBtn) return;
    fxApplyAmount = null;
    fxApplyBtn.disabled = true;
    fxApplyBtn.textContent = message;
  }

  function setFxApplyButtonResult(converted) {
    if (!fxApplyBtn) return;
    fxApplyAmount = Math.round(converted);
    fxApplyBtn.disabled = false;
    fxApplyBtn.textContent = `${fxApplyAmount.toLocaleString()} ${currency}를 지출액에 적용`;
  }

  if (fxAmountInput) {
    fxAmountInput.addEventListener("input", resetFxApplyButton);
  }

  if (fxSelect) {
    fxSelect.addEventListener("change", () => {
      renderFxCurrencyLabel();
      resetFxApplyButton();
    });
  }

  if (fxApplyBtn) {
    fxApplyBtn.addEventListener("click", () => {
      if (fxApplyBtn.disabled || fxApplyAmount === null) return;
      document.getElementById("amount").value = fxApplyAmount;
      showToast("지출액에 적용했습니다.");
    });
  }

  if (fxBtn) {
    fxBtn.addEventListener("click", async () => {
      const amount = parseFloat(fxAmountInput.value);
      const from = document.getElementById("fx-currency").value;
      if (!amount || amount <= 0) {
        resetFxApplyButton();
        fxAmountInput.focus();
        return;
      }
      setFxApplyButtonLoading();
      try {
        const data = await api(
          `/api/exchange-rate?from=${encodeURIComponent(from)}&amount=${encodeURIComponent(amount)}`
        );
        setFxApplyButtonResult(data.converted);
      } catch (err) {
        setFxApplyButtonError(err.message);
      }
    });
  }

  resetFxApplyButton();
}

// ---------------------------------------------------------------------------
// Dashboard page (monthly summary + filterable list)
// ---------------------------------------------------------------------------

let dashboardItems = [];
let dashboardCurrency = "KRW";
let dashboardFilter = "all";
let dashboardEditingID = null;

async function initDashboardPage() {
  await loadDashboard(); // defaults to the current month

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
    list.addEventListener("submit", handleDashboardEditSubmit);
  }
}

// formatMonthLabel turns "2026-06" into "2026년 6월".
function formatMonthLabel(ym) {
  const [y, m] = ym.split("-");
  return `${y}년 ${parseInt(m, 10)}월`;
}

function selectedDashboardMonth() {
  const sel = document.getElementById("month-select");
  return sel ? sel.value : "";
}

// loadDashboard fetches one month's summary (current month when month is unset),
// then refreshes the cards, the month dropdown, and the list.
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
            `<option value="${m}"${m === data.month ? " selected" : ""}>${formatMonthLabel(m)}</option>`
        )
        .join("");
    }

    document.getElementById("fixed-amount").textContent = fmtCurrency(data.fixed, dashboardCurrency);
    document.getElementById("variable-amount").textContent = fmtCurrency(data.variable, dashboardCurrency);
    document.getElementById("total-amount").textContent = fmtCurrency(data.total, dashboardCurrency);
    renderItems(dashboardFilter);
  } catch (e) {
    list.innerHTML =
      `<p class="text-red-500 p-4 text-center">${escapeHtml(e.message)}</p>`;
  }
}

function renderItems(filter) {
  const list = document.getElementById("expense-list");
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
      const merchant = escapeHtml(it.merchant) || "(가맹점 없음)";
      const desc = it.description
        ? `<div class="text-sm text-gray-500 truncate">${escapeHtml(it.description)}</div>`
        : "";
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
                <div class="font-medium truncate">${merchant}</div>
                ${desc}
                <div class="flex items-center gap-1 text-xs text-gray-400">
                  <span>${escapeHtml(it.date)}</span>
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
          <button
            type="button"
            data-edit-amount-delta="1000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
          >
            +1,000
          </button>
          <button
            type="button"
            data-edit-amount-delta="10000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
          >
            +10,000
          </button>
          <button
            type="button"
            data-edit-amount-delta="50000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700"
          >
            +50,000
          </button>
          <button
            type="button"
            data-edit-amount-delta="-1000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          >
            -1,000
          </button>
          <button
            type="button"
            data-edit-amount-delta="-10000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          >
            -10,000
          </button>
          <button
            type="button"
            data-edit-amount-delta="-50000"
            class="rounded-lg border border-gray-200 px-2 py-1.5 text-xs font-medium text-gray-600 hover:border-red-300 hover:bg-red-50 hover:text-red-700"
          >
            -50,000
          </button>
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
        <div class="grid grid-cols-3 gap-2">
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="once"${isChecked("once")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              일회성
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="monthly"${isChecked("monthly")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              월간결제
            </span>
          </label>
          <label class="cursor-pointer">
            <input type="radio" name="edit-payment-type-${it.id}" value="annual"${isChecked("annual")} class="peer sr-only" />
            <span class="flex h-full items-center justify-center text-center text-sm font-semibold py-2.5 px-2 rounded-lg border border-gray-300 text-gray-600 leading-tight transition hover:bg-gray-50 peer-checked:bg-indigo-600 peer-checked:text-white peer-checked:border-indigo-600">
              연간결제
            </span>
          </label>
        </div>
      </div>
      <button
        type="submit"
        class="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 rounded-lg transition"
      >
        수정
      </button>
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

function setDashboardEditAmountQuickVisible(form, isVisible) {
  if (!form || dashboardCurrency !== "KRW") return;
  const buttons = form.querySelector("[data-edit-amount-quick-buttons]");
  if (buttons) {
    buttons.classList.toggle("hidden", !isVisible);
  }
}

function shouldShowDashboardEditAmountQuick(form, target) {
  if (!form) return false;
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

function handleDashboardListClick(e) {
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
