// Package model holds gemsil's domain types and the pure, storage-independent
// validation logic that operates on them.
package model

import "time"

// Expense is a stored expense row.
type Expense struct {
	ID          int64   `json:"id"`
	Amount      float64 `json:"amount"`
	Merchant    string  `json:"merchant"`
	Description string  `json:"description"`
	PaymentType string  `json:"payment_type"`
	Date        string  `json:"date"`
	CreatedAt   string  `json:"created_at"`
	// StartMonth/EndMonth bound a recurring expense's effective range ("YYYY-MM",
	// end inclusive). EndMonth empty means "ongoing". Ignored for one-time expenses.
	StartMonth string `json:"start_month,omitempty"`
	EndMonth   string `json:"end_month,omitempty"`
}

// DashboardItem is one line in a month's expense list.
type DashboardItem struct {
	ID          int64   `json:"id"`
	Category    string  `json:"category"` // "fixed" | "variable"
	PaymentType string  `json:"payment_type"`
	Merchant    string  `json:"merchant"`
	Description string  `json:"description"`
	Amount      float64 `json:"amount"`                // amount counted toward this month
	FullAmount  float64 `json:"full_amount,omitempty"` // for annual: the full yearly amount
	Date        string  `json:"date"`
	CreatedAt   string  `json:"created_at"`            // RFC3339; registration timestamp
	StartMonth  string  `json:"start_month,omitempty"` // recurring effective start ("YYYY-MM")
	EndMonth    string  `json:"end_month,omitempty"`   // recurring effective end, inclusive; empty = ongoing
}

// ExpenseGoal is a monthly target snapshot. Edits are append-only: the newest
// snapshot for a month is treated as the active target.
type ExpenseGoal struct {
	ID        int64   `json:"id"`
	Month     string  `json:"month"`
	Amount    float64 `json:"amount"`
	CreatedAt string  `json:"created_at"`
}

// ActualExpense is a monthly actual-spending snapshot: the total amount the user
// reports having actually paid this month. Edits are append-only, like
// ExpenseGoal — the newest snapshot for a month is the active value.
type ActualExpense struct {
	ID        int64   `json:"id"`
	Month     string  `json:"month"`
	Amount    float64 `json:"amount"`
	CreatedAt string  `json:"created_at"`
}

// AllowedTypes is the set of valid payment_type values.
var AllowedTypes = map[string]bool{"once": true, "monthly": true, "annual": true}

// ValidPaymentType reports whether t is a recognized payment_type.
func ValidPaymentType(t string) bool { return AllowedTypes[t] }

// ValidYearMonth reports whether s is a well-formed "YYYY-MM" period.
func ValidYearMonth(s string) bool {
	_, err := time.Parse("2006-01", s)
	return err == nil
}

// ValidateMonthRange checks a recurring expense's effective range. start must be
// a valid "YYYY-MM"; end may be empty ("ongoing") or a valid month not earlier
// than start. One-time expenses have no end. Returns a Korean error message when
// invalid, or "" when valid. (Lexicographic compare is correct for "YYYY-MM".)
func ValidateMonthRange(ptype, start, end string) string {
	if !ValidYearMonth(start) {
		return "시작 월 형식이 올바르지 않습니다."
	}
	if ptype == "once" || end == "" {
		return ""
	}
	if !ValidYearMonth(end) {
		return "종료 월 형식이 올바르지 않습니다."
	}
	if end < start {
		return "종료 월은 시작 월보다 빠를 수 없습니다."
	}
	return ""
}

// ResolveMonthRange computes the effective start/end months for an update. One-time
// expenses are always pinned to their own month with no end. For recurring ones,
// nil inputs keep the current value (falling back to the registration month when
// unset); a non-nil pointer overrides, and EndMonth="" clears the end.
func ResolveMonthRange(ptype, date, curStart, curEnd string, startIn, endIn *string) (start, end string) {
	monthOf := func(d string) string {
		if len(d) >= 7 {
			return d[:7]
		}
		return d
	}
	if ptype == "once" {
		return monthOf(date), ""
	}
	start = curStart
	if start == "" {
		start = monthOf(date)
	}
	if startIn != nil {
		start = *startIn
	}
	end = curEnd
	if endIn != nil {
		end = *endIn
	}
	return start, end
}
