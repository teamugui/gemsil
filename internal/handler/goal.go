package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"gemsil/internal/model"
)

// requestMonthOrCurrent reads a ?month=YYYY-MM query param, defaulting to the
// current month. It returns a non-empty error message for a malformed value.
func requestMonthOrCurrent(r *http.Request) (string, string) {
	month := r.URL.Query().Get("month")
	if month == "" {
		return time.Now().Format("2006-01"), ""
	}
	if !model.ValidYearMonth(month) {
		return "", "월 형식이 올바르지 않습니다."
	}
	return month, ""
}

func (h *Handler) GetExpenseGoal(w http.ResponseWriter, r *http.Request) {
	month, msg := requestMonthOrCurrent(r)
	if msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	goal, err := h.store.LatestExpenseGoal(month)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month": month,
		"goal":  goal,
	})
}

func (h *Handler) CreateExpenseGoal(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount float64 `json:"amount"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "목표 금액은 0보다 커야 합니다.")
		return
	}

	now := time.Now()
	goal := model.ExpenseGoal{
		Month:     now.Format("2006-01"),
		Amount:    in.Amount,
		CreatedAt: now.Format(time.RFC3339),
	}
	id, err := h.store.CreateExpenseGoal(goal)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
		return
	}
	goal.ID = id
	writeJSON(w, http.StatusCreated, goal)
}

func (h *Handler) ListExpenseGoalHistory(w http.ResponseWriter, r *http.Request) {
	month, msg := requestMonthOrCurrent(r)
	if msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	goals, err := h.store.ListExpenseGoalHistory(month)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"month":   month,
		"history": goals,
	})
}
