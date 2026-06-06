import { EVENTS, FX_CURRENCIES, api, dispatchAppEvent, getCurrency, showToast } from "./helper.js";

let formInitialized = false;

export async function initFormComponent() {
  const setupEl = document.getElementById("currency-setup");
  const appEl = document.getElementById("main-app");
  if (!setupEl || !appEl) return;

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
      btn.addEventListener(
        "click",
        async () => {
          const chosen = btn.getAttribute("data-currency-choice");
          try {
            await api("/api/settings", {
              method: "POST",
              body: JSON.stringify({ currency: chosen }),
            });
            setupEl.classList.add("hidden");
            appEl.classList.remove("hidden");
            setupFormApp(chosen);
            dispatchAppEvent(EVENTS.currencyChanged, { currency: chosen });
          } catch (err) {
            alert(err.message);
          }
        }
      );
    });
    return;
  }

  setupEl.classList.add("hidden");
  appEl.classList.remove("hidden");
  setupFormApp(currency);
  dispatchAppEvent(EVENTS.currencyChanged, { currency });
}

function setupFormApp(currency) {
  if (formInitialized) {
    renderBaseCurrency(currency);
    renderFxCurrencyOptions(currency);
    return;
  }

  formInitialized = true;
  renderEntryTitle();
  renderBaseCurrency(currency);
  renderFxCurrencyOptions(currency);

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
  let activeCurrency = currency;

  function setAmountQuickButtonsVisible(isVisible) {
    if (!amountQuickButtons) return;
    amountQuickButtons.classList.toggle("hidden", activeCurrency !== "KRW" || !isVisible);
  }

  function currentAmountValue() {
    const amount = parseFloat(amountInput.value);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }

  document.addEventListener(EVENTS.currencyChanged, (e) => {
    activeCurrency = e.detail.currency || activeCurrency;
    renderBaseCurrency(activeCurrency);
    renderFxCurrencyOptions(activeCurrency);
    setAmountQuickButtonsVisible(false);
  });

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

  const resetFxApplyButton = initFxCalculator(() => activeCurrency);

  const form = document.getElementById("expense-form");
  if (form && amountInput) {
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
        dispatchAppEvent(EVENTS.expenseChanged);
      } catch (err) {
        showToast(err.message, true);
      }
    });
  }
}

function renderEntryTitle() {
  const titleEl = document.getElementById("entry-page-title");
  if (!titleEl) return;
  const now = new Date();
  titleEl.textContent = `${now.getMonth() + 1}월 ${now.getDate()}일 지출입력`;
}

function renderBaseCurrency(currency) {
  document.querySelectorAll("[data-base-currency]").forEach((el) => {
    el.textContent = currency;
  });
}

function renderFxCurrencyOptions(currency) {
  const fxSelect = document.getElementById("fx-currency");
  const fxFromCurrency = document.getElementById("fx-from-currency");
  if (!fxSelect) return;

  const previousValue = fxSelect.value;
  fxSelect.innerHTML = "";
  FX_CURRENCIES.filter((c) => c !== currency).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    fxSelect.appendChild(opt);
  });
  if (previousValue && previousValue !== currency) {
    fxSelect.value = previousValue;
  }
  if (fxFromCurrency) {
    fxFromCurrency.textContent = fxSelect.value || "";
  }
}

function initFxCalculator(currentCurrency) {
  const fxToggle = document.getElementById("fx-toggle");
  const fxAmountInput = document.getElementById("fx-amount");
  const fxSelect = document.getElementById("fx-currency");
  const fxFromCurrency = document.getElementById("fx-from-currency");
  const fxBtn = document.getElementById("fx-calc-btn");
  const fxApplyBtn = document.getElementById("fx-apply-btn");
  let fxApplyAmount = null;

  function renderFxCurrencyLabel() {
    if (!fxFromCurrency || !fxSelect) return;
    fxFromCurrency.textContent = fxSelect.value || "";
  }

  function resetFxApplyButton() {
    if (!fxApplyBtn || !fxAmountInput) return;
    const amount = parseFloat(fxAmountInput.value);
    fxApplyAmount = null;
    fxApplyBtn.disabled = true;
    fxApplyBtn.textContent =
      Number.isFinite(amount) && amount > 0 ? "계산버튼을 눌러주세요" : "계산할 금액을 입력해주세요";
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
    const currency = currentCurrency();
    fxApplyAmount = Math.round(converted);
    fxApplyBtn.disabled = false;
    fxApplyBtn.textContent = `${fxApplyAmount.toLocaleString()} ${currency}를 지출액에 적용`;
  }

  if (fxToggle) {
    fxToggle.addEventListener("click", () => {
      document.getElementById("fx-panel").classList.toggle("hidden");
    });
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

  if (fxBtn && fxAmountInput && fxSelect) {
    fxBtn.addEventListener("click", async () => {
      const amount = parseFloat(fxAmountInput.value);
      const from = fxSelect.value;
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
  return resetFxApplyButton;
}
