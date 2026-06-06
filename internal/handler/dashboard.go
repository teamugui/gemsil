package handler

import (
	"net/http"
	"strings"
	"time"

	"gemsil/internal/model"
)

// Dashboard computes a month's totals using a virtual/computed model: recurring
// expenses are stored once and their monthly contribution is derived here. A
// recurring expense counts for every month from its start month onward (monthly
// at full amount, annual prorated as amount/12). One-time expenses count only in
// the month they were entered.
func (h *Handler) Dashboard(w http.ResponseWriter, r *http.Request) {
	currency, _ := h.store.GetSetting("currency")
	currentYM := time.Now().Format("2006-01")

	// The viewed month defaults to the current one; a ?month=YYYY-MM query
	// param selects a different period. Invalid values fall back to current.
	ym := currentYM
	if m := r.URL.Query().Get("month"); model.ValidYearMonth(m) {
		ym = m
	}

	expenses, err := h.store.ActiveExpenses(ym)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}

	var fixed, variable float64
	items := []model.DashboardItem{}
	for _, e := range expenses {
		switch e.PaymentType {
		case "once":
			// One-time expenses only count in the month they happened.
			if strings.HasPrefix(e.Date, ym) {
				variable += e.Amount
				items = append(items, model.DashboardItem{
					ID: e.ID, Category: "variable", PaymentType: e.PaymentType,
					Merchant: e.Merchant, Description: e.Description, Amount: e.Amount, Date: e.Date,
					CreatedAt: e.CreatedAt,
				})
			}
		case "monthly":
			fixed += e.Amount
			items = append(items, model.DashboardItem{
				ID: e.ID, Category: "fixed", PaymentType: e.PaymentType,
				Merchant: e.Merchant, Description: e.Description, Amount: e.Amount, Date: e.Date,
				CreatedAt: e.CreatedAt, StartMonth: e.StartMonth, EndMonth: e.EndMonth,
			})
		case "annual":
			prorated := e.Amount / 12
			fixed += prorated
			items = append(items, model.DashboardItem{
				ID: e.ID, Category: "fixed", PaymentType: e.PaymentType,
				Merchant: e.Merchant, Description: e.Description, Amount: prorated, FullAmount: e.Amount, Date: e.Date,
				CreatedAt: e.CreatedAt, StartMonth: e.StartMonth, EndMonth: e.EndMonth,
			})
		}
	}

	total := fixed + variable
	var (
		goalAmount    any
		goalCreatedAt any
		remaining     any
		usageRate     any
	)
	if goal, err := h.store.LatestExpenseGoal(ym); err == nil && goal != nil {
		goalAmount = goal.Amount
		goalCreatedAt = goal.CreatedAt
		remaining = goal.Amount - total
		usageRate = total / goal.Amount
	} else if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"currency":         currency,
		"month":            ym,
		"months":           h.availableMonths(currentYM),
		"fixed":            fixed,
		"variable":         variable,
		"total":            total,
		"goal_amount":      goalAmount,
		"goal_created_at":  goalCreatedAt,
		"remaining_amount": remaining,
		"goal_usage_rate":  usageRate,
		"items":            items,
	})
}

// availableMonths lists every "YYYY-MM" period the dashboard can show — from the
// earliest expense month through the current month (inclusive), newest first.
// Recurring expenses make every month in this contiguous range meaningful.
func (h *Handler) availableMonths(currentYM string) []string {
	earliest, _ := h.store.EarliestExpenseMonth()

	start := currentYM
	if earliest != "" && earliest < currentYM {
		start = earliest
	}

	startT, err := time.Parse("2006-01", start)
	if err != nil {
		return []string{currentYM}
	}
	currentT, _ := time.Parse("2006-01", currentYM)

	months := []string{}
	for t := startT; !t.After(currentT); t = t.AddDate(0, 1, 0) {
		months = append(months, t.Format("2006-01"))
	}
	// Reverse so the newest month appears first in the dropdown.
	for i, j := 0, len(months)-1; i < j; i, j = i+1, j-1 {
		months[i], months[j] = months[j], months[i]
	}
	return months
}
