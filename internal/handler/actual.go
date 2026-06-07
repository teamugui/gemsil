package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"gemsil/internal/model"
)

func (h *Handler) GetActualExpense(w http.ResponseWriter, r *http.Request) {
	month, msg := requestMonthOrCurrent(r)
	if msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	actual, err := h.store.LatestActualExpense(month)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":  month,
		"actual": actual,
	})
}

func (h *Handler) CreateActualExpense(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "금액은 0보다 커야 합니다.")
		return
	}

	now := time.Now()
	month := now.Format("2006-01")

	current, err := h.store.LatestActualExpense(month)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	if current != nil && current.Amount == in.Amount {
		httpError(w, http.StatusConflict, "실제 지출액이 변경되지 않았습니다.")
		return
	}

	actual := model.ActualExpense{
		Month:     month,
		Amount:    in.Amount,
		CreatedAt: now.Format(time.RFC3339),
	}
	id, err := h.store.CreateActualExpense(actual)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
		return
	}
	actual.ID = id
	writeJSON(w, http.StatusCreated, actual)
}

func (h *Handler) ListActualExpenseHistory(w http.ResponseWriter, r *http.Request) {
	month, msg := requestMonthOrCurrent(r)
	if msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	actuals, err := h.store.ListActualExpenseHistory(month)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":   month,
		"history": actuals,
	})
}
