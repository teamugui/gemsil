import {
  EVENTS,
  FX_CURRENCIES,
  api,
  clampedAmountAfterDelta,
  dispatchAppEvent,
  escapeHtml,
  getCurrency,
  showToast,
} from "./helper.js";

let formInitialized = false;

export async function initFormComponent() {
  const setupEl = document.getElementById("currency-setup");
  const appEl = document.getElementById("main-app");
  if (!setupEl || !appEl) return;

  let currency = "";
  try {
    currency = await getCurrency();
  } catch {
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
          setupFormApp(chosen);
          dispatchAppEvent(EVENTS.currencyChanged, { currency: chosen });
        } catch (err) {
          alert(err.message);
        }
      });
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
    optionalFields.style.maxHeight = isOpen ? `${optionalFields.scrollHeight}px` : "0";
    optionalFields.style.opacity = isOpen ? "1" : "0";
    optionalFields.style.marginTop = isOpen ? "0.25rem" : "0";
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
        amountInput.value = String(clampedAmountAfterDelta(amountInput.value, delta));
        amountInput.focus();
        setAmountQuickButtonsVisible(true);
      });
    });
  }

  const resetFxApplyButton = initFxCalculator(() => activeCurrency);
  const closeMerchantSuggestions = initMerchantAutocomplete();

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
        if (closeMerchantSuggestions) closeMerchantSuggestions();
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

// Wires server-backed autocomplete onto the 지출처 (#merchant) input: as the user
// types, matching past merchants are fetched and shown in a dropdown below the
// field, selectable by click or keyboard. Returns a function that closes the
// dropdown (used after a successful save). Returns null if the elements are absent.
function initMerchantAutocomplete() {
  const input = document.getElementById("merchant");
  const listEl = document.getElementById("merchant-suggestions");
  if (!input || !listEl) return null;

  let items = [];
  let activeIndex = -1;
  let requestSeq = 0;
  let debounceTimer = null;

  function closeSuggestions() {
    listEl.classList.add("hidden");
    listEl.innerHTML = "";
    items = [];
    activeIndex = -1;
  }

  function renderActive() {
    Array.from(listEl.children).forEach((li, i) => {
      const isActive = i === activeIndex;
      li.classList.toggle("bg-teal-50", isActive);
      li.classList.toggle("text-teal-700", isActive);
      if (isActive) li.scrollIntoView({ block: "nearest" });
    });
  }

  function renderSuggestions(results) {
    items = results;
    activeIndex = -1;
    if (!results.length) {
      closeSuggestions();
      return;
    }
    listEl.innerHTML = results
      .map(
        (m, i) =>
          `<li role="option" data-index="${i}" class="cursor-pointer px-3 py-2 hover:bg-teal-50 hover:text-teal-700">${escapeHtml(m)}</li>`,
      )
      .join("");
    listEl.classList.remove("hidden");
  }

  function selectItem(index) {
    if (index < 0 || index >= items.length) return;
    input.value = items[index];
    closeSuggestions();
    input.focus();
  }

  async function fetchSuggestions(query) {
    const seq = ++requestSeq;
    try {
      const results = await api(`/api/merchants?q=${encodeURIComponent(query)}`);
      if (seq !== requestSeq) return; // a newer request superseded this one
      renderSuggestions(Array.isArray(results) ? results : []);
    } catch {
      if (seq === requestSeq) closeSuggestions();
    }
  }

  input.addEventListener("input", () => {
    const query = input.value.trim();
    clearTimeout(debounceTimer);
    if (!query) {
      requestSeq++; // invalidate any in-flight response
      closeSuggestions();
      return;
    }
    debounceTimer = setTimeout(() => fetchSuggestions(query), 150);
  });

  input.addEventListener("keydown", (e) => {
    if (listEl.classList.contains("hidden") || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = (activeIndex + 1) % items.length;
      renderActive();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = (activeIndex - 1 + items.length) % items.length;
      renderActive();
    } else if (e.key === "Enter") {
      if (activeIndex >= 0) {
        e.preventDefault();
        selectItem(activeIndex);
      }
    } else if (e.key === "Escape") {
      closeSuggestions();
    }
  });

  // mousedown fires before the input loses focus; preventing default keeps focus
  // on the input so the subsequent click can apply the selection.
  listEl.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });
  listEl.addEventListener("click", (e) => {
    const li = e.target.closest("[data-index]");
    if (!li) return;
    selectItem(Number(li.getAttribute("data-index")));
  });

  // Close when focus moves outside the input and its suggestion list.
  document.addEventListener("focusin", (e) => {
    if (e.target !== input && !listEl.contains(e.target)) {
      closeSuggestions();
    }
  });

  return closeSuggestions;
}

function renderEntryTitle() {
  const titleEl = document.getElementById("entry-page-title-text");
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
  const fxPanel = document.getElementById("fx-panel");
  const fxToggleIcon = document.getElementById("fx-toggle-icon");
  const fxAmountInput = document.getElementById("fx-amount");
  const fxSelect = document.getElementById("fx-currency");
  const fxFromCurrency = document.getElementById("fx-from-currency");
  const fxBtn = document.getElementById("fx-calc-btn");
  const fxApplyBtn = document.getElementById("fx-apply-btn");
  const fxRateNote = document.getElementById("fx-rate-note");
  let fxApplyAmount = null;

  function formatRateValue(rate) {
    if (!Number.isFinite(rate)) return "";
    return new Intl.NumberFormat("ko-KR", {
      useGrouping: false,
      maximumFractionDigits: rate >= 100 ? 0 : 4,
    }).format(rate);
  }

  function refreshFxPanelHeight() {
    if (!fxToggle || !fxPanel || fxToggle.getAttribute("aria-expanded") !== "true") return;
    fxPanel.style.maxHeight = `${fxPanel.scrollHeight}px`;
  }

  function resetFxRateNote() {
    if (!fxRateNote) return;
    fxRateNote.textContent = "환율은 참고용입니다. 변환된 금액을 확인 후 입력하세요.";
    refreshFxPanelHeight();
  }

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
    const currency = currentCurrency();
    fxApplyAmount = Math.round(converted);
    fxApplyBtn.disabled = false;
    fxApplyBtn.textContent = `${fxApplyAmount.toLocaleString()} ${currency}를 지출액에 적용`;
  }

  function setFxRateNoteResult(data) {
    if (!fxRateNote) return;
    const from = data.from || (fxSelect && fxSelect.value) || "";
    const to = data.to || currentCurrency();
    const rate = formatRateValue(Number(data.rate));
    if (!from || !to || !rate) {
      resetFxRateNote();
      return;
    }
    fxRateNote.textContent = `환율(1${from}=${rate}${to})는 참고용입니다. 변환된 금액을 확인 후 입력하세요`;
    refreshFxPanelHeight();
  }

  function setFxPanelOpen(isOpen) {
    if (!fxToggle || !fxPanel || !fxToggleIcon) return;
    fxPanel.style.maxHeight = isOpen ? `${fxPanel.scrollHeight}px` : "0";
    fxPanel.style.opacity = isOpen ? "1" : "0";
    fxPanel.style.marginTop = isOpen ? "1rem" : "0";
    fxToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    fxToggleIcon.textContent = isOpen ? "▼" : "▶";
  }

  if (fxToggle && fxPanel) {
    fxToggle.addEventListener("click", () => {
      setFxPanelOpen(fxToggle.getAttribute("aria-expanded") !== "true");
    });
  }

  if (fxAmountInput) {
    fxAmountInput.addEventListener("input", () => {
      resetFxApplyButton();
      resetFxRateNote();
    });
  }

  if (fxSelect) {
    fxSelect.addEventListener("change", () => {
      renderFxCurrencyLabel();
      resetFxApplyButton();
      resetFxRateNote();
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
          `/api/exchange-rate?from=${encodeURIComponent(from)}&amount=${encodeURIComponent(amount)}`,
        );
        setFxApplyButtonResult(data.converted);
        setFxRateNoteResult(data);
      } catch (err) {
        setFxApplyButtonError(err.message);
        resetFxRateNote();
      }
    });
  }

  resetFxApplyButton();
  resetFxRateNote();
  return resetFxApplyButton;
}
