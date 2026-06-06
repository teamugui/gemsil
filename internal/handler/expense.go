package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"gemsil/internal/model"
)

func (h *Handler) CreateExpense(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount      float64 `json:"amount"`
		Merchant    string  `json:"merchant"`
		Description string  `json:"description"`
		PaymentType string  `json:"payment_type"`
		StartMonth  string  `json:"start_month"` // optional; recurring effective start
		EndMonth    string  `json:"end_month"`   // optional; recurring effective end (inclusive)
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "금액은 0보다 커야 합니다.")
		return
	}
	if !model.ValidPaymentType(in.PaymentType) {
		httpError(w, http.StatusBadRequest, "결제 유형이 올바르지 않습니다.")
		return
	}

	// The date is always set by the server to today — never client-supplied.
	now := time.Now()
	date := now.Format("2006-01-02")
	createdAt := now.Format(time.RFC3339)
	currentMonth := now.Format("2006-01")

	// One-time expenses are pinned to their own month; recurring ones may start in
	// a chosen month (defaulting to the current one) and optionally end later.
	startMonth, endMonth := currentMonth, ""
	if in.PaymentType != "once" {
		if in.StartMonth != "" {
			startMonth = in.StartMonth
		}
		endMonth = in.EndMonth
	}
	if msg := model.ValidateMonthRange(in.PaymentType, startMonth, endMonth); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	e := model.Expense{
		Amount: in.Amount, Merchant: in.Merchant, Description: in.Description,
		PaymentType: in.PaymentType, Date: date, CreatedAt: createdAt,
		StartMonth: startMonth, EndMonth: endMonth,
	}
	id, err := h.store.CreateExpense(e)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
		return
	}
	e.ID = id
	writeJSON(w, http.StatusCreated, e)
}

func (h *Handler) ListExpenses(w http.ResponseWriter, r *http.Request) {
	filter := ""
	if t := r.URL.Query().Get("type"); model.AllowedTypes[t] {
		filter = t
	}
	expenses, err := h.store.ListExpenses(filter)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, expenses)
}

func (h *Handler) UpdateExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := expenseIDFromRequest(r)
	if !ok {
		httpError(w, http.StatusBadRequest, "지출 ID가 올바르지 않습니다.")
		return
	}

	var in struct {
		Amount      float64 `json:"amount"`
		Merchant    string  `json:"merchant"`
		Description string  `json:"description"`
		PaymentType string  `json:"payment_type"`
		// Pointers distinguish "absent" (keep existing) from an explicit value.
		// EndMonth set to "" clears the end (makes the expense ongoing again).
		StartMonth *string `json:"start_month"`
		EndMonth   *string `json:"end_month"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "금액은 0보다 커야 합니다.")
		return
	}
	if !model.ValidPaymentType(in.PaymentType) {
		httpError(w, http.StatusBadRequest, "결제 유형이 올바르지 않습니다.")
		return
	}

	// Load the current effective range to use as the baseline for partial updates.
	cur, found, err := h.store.GetExpense(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	if !found {
		httpError(w, http.StatusNotFound, "지출 내역을 찾을 수 없습니다.")
		return
	}

	startMonth, endMonth := model.ResolveMonthRange(in.PaymentType, cur.Date, cur.StartMonth, cur.EndMonth, in.StartMonth, in.EndMonth)
	if msg := model.ValidateMonthRange(in.PaymentType, startMonth, endMonth); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	if err := h.store.UpdateExpense(id, model.Expense{
		Amount: in.Amount, Merchant: in.Merchant, Description: in.Description,
		PaymentType: in.PaymentType, StartMonth: startMonth, EndMonth: endMonth,
	}); err != nil {
		httpError(w, http.StatusInternalServerError, "수정에 실패했습니다.")
		return
	}

	e, _, err := h.store.GetExpense(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, e)
}

func (h *Handler) DeleteExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := expenseIDFromRequest(r)
	if !ok {
		httpError(w, http.StatusBadRequest, "지출 ID가 올바르지 않습니다.")
		return
	}

	found, err := h.store.DeleteExpense(id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "삭제에 실패했습니다.")
		return
	}
	if !found {
		httpError(w, http.StatusNotFound, "지출 내역을 찾을 수 없습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
