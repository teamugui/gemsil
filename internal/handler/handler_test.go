package handler

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	_ "modernc.org/sqlite"

	"gemsil/internal/model"
	"gemsil/internal/store"
)

// setupTestHandler builds a Handler backed by a fresh temporary database and
// returns it alongside the raw *sql.DB for direct seeding.
func setupTestHandler(t *testing.T) (*Handler, *sql.DB) {
	t.Helper()
	d, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	st, err := store.New(d)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return New(st, nil), d
}

// insertRecurring inserts a recurring expense with an explicit effective range.
// end == "" stores SQL NULL (ongoing).
func insertRecurring(t *testing.T, db *sql.DB, amount float64, ptype, startMonth, end string) {
	t.Helper()
	date := startMonth + "-01"
	var endVal any
	if end != "" {
		endVal = end
	}
	if _, err := db.Exec(
		`INSERT INTO expenses (amount, merchant, description, payment_type, date, created_at, start_month, end_month)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		amount, "m", "d", ptype, date, date+"T00:00:00Z", startMonth, endVal,
	); err != nil {
		t.Fatalf("insert: %v", err)
	}
}

// dashboard returns the (fixed, variable) totals the dashboard reports for ym.
func dashboard(t *testing.T, h *Handler, ym string) (fixed, variable float64) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month="+ym, nil)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard %s: status %d: %s", ym, rec.Code, rec.Body.String())
	}
	var out struct {
		Fixed    float64 `json:"fixed"`
		Variable float64 `json:"variable"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	return out.Fixed, out.Variable
}

func TestDashboardOngoingMonthlyCarriesForward(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "")

	if f, _ := dashboard(t, h, "2025-12"); f != 0 {
		t.Errorf("before start: fixed = %v, want 0", f)
	}
	if f, _ := dashboard(t, h, "2026-01"); f != 100 {
		t.Errorf("start month: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, h, "2026-09"); f != 100 {
		t.Errorf("later month: fixed = %v, want 100", f)
	}
}

func TestDashboardEndMonthStopsAfterInclusive(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "2026-03")

	if f, _ := dashboard(t, h, "2026-03"); f != 100 {
		t.Errorf("end month is inclusive: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, h, "2026-04"); f != 0 {
		t.Errorf("after end: fixed = %v, want 0", f)
	}
}

func TestDashboardAnnualProrated(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 1200, "annual", "2026-01", "")
	if f, _ := dashboard(t, h, "2026-05"); f != 100 {
		t.Errorf("annual prorated: fixed = %v, want 100", f)
	}
}

func TestDashboardOnceCountsOnlyItsMonth(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 50, "once", "2026-02", "") // helper sets date 2026-02-01
	if _, v := dashboard(t, h, "2026-02"); v != 50 {
		t.Errorf("its month: variable = %v, want 50", v)
	}
	if _, v := dashboard(t, h, "2026-03"); v != 0 {
		t.Errorf("other month: variable = %v, want 0", v)
	}
}

// An amount change is modeled as "end the old row, start a new one the next
// month". The two rows must tile the timeline with no gap and no overlap.
func TestDashboardAmountChangeNoOverlap(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "2026-05")
	insertRecurring(t, db, 110, "monthly", "2026-06", "")

	if f, _ := dashboard(t, h, "2026-05"); f != 100 {
		t.Errorf("last old month: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, h, "2026-06"); f != 110 {
		t.Errorf("first new month: fixed = %v, want 110 (no double count)", f)
	}
}

func TestDashboardIncludesGoalProgress(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "")
	if _, err := db.Exec(
		`INSERT INTO expense_goals (month, amount, created_at) VALUES (?, ?, ?)`,
		"2026-01", 250.0, "2026-01-02T00:00:00Z",
	); err != nil {
		t.Fatalf("insert goal: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO actual_expenses (month, amount, created_at) VALUES (?, ?, ?)`,
		"2026-01", 200.0, "2026-01-03T00:00:00Z",
	); err != nil {
		t.Fatalf("insert actual: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		GoalAmount      *float64 `json:"goal_amount"`
		Remaining       *float64 `json:"remaining_amount"`
		GoalUsageRate   *float64 `json:"goal_usage_rate"`
		GoalCreatedAt   *string  `json:"goal_created_at"`
		ActualAmount    *float64 `json:"actual_amount"`
		ActualRemaining *float64 `json:"actual_remaining"`
		ActualUsageRate *float64 `json:"actual_usage_rate"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.GoalAmount == nil || *out.GoalAmount != 250 {
		t.Fatalf("goal_amount = %v, want 250", out.GoalAmount)
	}
	if out.Remaining == nil || *out.Remaining != 150 {
		t.Fatalf("remaining_amount = %v, want 150", out.Remaining)
	}
	if out.GoalUsageRate == nil || *out.GoalUsageRate != 0.4 {
		t.Fatalf("goal_usage_rate = %v, want 0.4", out.GoalUsageRate)
	}
	if out.GoalCreatedAt == nil || *out.GoalCreatedAt != "2026-01-02T00:00:00Z" {
		t.Fatalf("goal_created_at = %v, want timestamp", out.GoalCreatedAt)
	}
	if out.ActualAmount == nil || *out.ActualAmount != 200 {
		t.Fatalf("actual_amount = %v, want 200", out.ActualAmount)
	}
	if out.ActualRemaining == nil || *out.ActualRemaining != 50 {
		t.Fatalf("actual_remaining = %v, want 50", out.ActualRemaining)
	}
	if out.ActualUsageRate == nil || *out.ActualUsageRate != 0.8 {
		t.Fatalf("actual_usage_rate = %v, want 0.8", out.ActualUsageRate)
	}
}

func TestDashboardReconciliationMetrics(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "") // total = 100
	if _, err := db.Exec(
		`INSERT INTO expense_goals (month, amount, created_at) VALUES (?, ?, ?)`,
		"2026-01", 250.0, "2026-01-02T00:00:00Z",
	); err != nil {
		t.Fatalf("insert goal: %v", err)
	}
	if _, err := db.Exec(
		`INSERT INTO actual_expenses (month, amount, created_at) VALUES (?, ?, ?)`,
		"2026-01", 200.0, "2026-01-03T00:00:00Z",
	); err != nil {
		t.Fatalf("insert actual: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Untracked         *float64 `json:"untracked_amount"`
		TrackingCoverage  *float64 `json:"tracking_coverage"`
		CumulativeSavings *float64 `json:"cumulative_savings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Untracked == nil || *out.Untracked != 100 { // actual 200 − total 100
		t.Fatalf("untracked_amount = %v, want 100", out.Untracked)
	}
	if out.TrackingCoverage == nil || *out.TrackingCoverage != 0.5 { // total 100 / actual 200
		t.Fatalf("tracking_coverage = %v, want 0.5", out.TrackingCoverage)
	}
	if out.CumulativeSavings == nil || *out.CumulativeSavings != 50 { // goal 250 − actual 200
		t.Fatalf("cumulative_savings = %v, want 50", out.CumulativeSavings)
	}
}

func TestDashboardReconciliationNullWhenUnset(t *testing.T) {
	h, db := setupTestHandler(t)
	insertRecurring(t, db, 100, "monthly", "2026-01", "") // total only, no goal/actual

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		Untracked         *float64 `json:"untracked_amount"`
		TrackingCoverage  *float64 `json:"tracking_coverage"`
		CumulativeSavings *float64 `json:"cumulative_savings"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Untracked != nil {
		t.Fatalf("untracked_amount = %v, want nil", *out.Untracked)
	}
	if out.TrackingCoverage != nil {
		t.Fatalf("tracking_coverage = %v, want nil", *out.TrackingCoverage)
	}
	if out.CumulativeSavings != nil {
		t.Fatalf("cumulative_savings = %v, want nil", *out.CumulativeSavings)
	}
}

func TestDashboardGoalFieldsNullWhenUnset(t *testing.T) {
	h, _ := setupTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	h.Dashboard(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		GoalAmount   *float64 `json:"goal_amount"`
		Remaining    *float64 `json:"remaining_amount"`
		ActualAmount *float64 `json:"actual_amount"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.GoalAmount != nil {
		t.Fatalf("goal_amount = %v, want nil", *out.GoalAmount)
	}
	if out.Remaining != nil {
		t.Fatalf("remaining_amount = %v, want nil", *out.Remaining)
	}
	if out.ActualAmount != nil {
		t.Fatalf("actual_amount = %v, want nil", *out.ActualAmount)
	}
}

// --- handler tests -------------------------------------------------------

func postExpense(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/expenses", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.CreateExpense(rec, req)
	return rec
}

func putExpense(t *testing.T, h *Handler, id int64, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/expenses/"+strconv.FormatInt(id, 10), bytes.NewBufferString(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.FormatInt(id, 10))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	h.UpdateExpense(rec, req)
	return rec
}

func postExpenseGoal(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/expense-goals", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.CreateExpenseGoal(rec, req)
	return rec
}

func getExpenseGoalForMonth(t *testing.T, h *Handler, month string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/expense-goals?month="+month, nil)
	rec := httptest.NewRecorder()
	h.GetExpenseGoal(rec, req)
	return rec
}

func TestCreateRejectsEndBeforeStart(t *testing.T) {
	h, _ := setupTestHandler(t)
	rec := postExpense(t, h, `{"amount":100,"payment_type":"monthly","start_month":"2026-05","end_month":"2026-03"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestExpenseGoalSnapshotsLatest(t *testing.T) {
	h, db := setupTestHandler(t)
	currentMonth := time.Now().Format("2006-01")

	if rec := postExpenseGoal(t, h, `{"amount":100}`); rec.Code != http.StatusCreated {
		t.Fatalf("first goal status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := postExpenseGoal(t, h, `{"amount":150}`); rec.Code != http.StatusCreated {
		t.Fatalf("second goal status = %d: %s", rec.Code, rec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM expense_goals WHERE month = ?`, currentMonth).Scan(&count); err != nil {
		t.Fatalf("count goals: %v", err)
	}
	if count != 2 {
		t.Fatalf("goal row count = %d, want 2", count)
	}

	rec := getExpenseGoalForMonth(t, h, currentMonth)
	if rec.Code != http.StatusOK {
		t.Fatalf("get goal status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Goal *model.ExpenseGoal `json:"goal"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Goal == nil || out.Goal.Amount != 150 {
		t.Fatalf("latest goal = %+v, want amount 150", out.Goal)
	}
}

func TestCreateExpenseGoalRejectsNonPositiveAmount(t *testing.T) {
	h, _ := setupTestHandler(t)
	rec := postExpenseGoal(t, h, `{"amount":0}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateExpenseGoalRejectsUnchangedAmount(t *testing.T) {
	h, db := setupTestHandler(t)
	currentMonth := time.Now().Format("2006-01")

	if rec := postExpenseGoal(t, h, `{"amount":100}`); rec.Code != http.StatusCreated {
		t.Fatalf("first goal status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := postExpenseGoal(t, h, `{"amount":100}`); rec.Code != http.StatusConflict {
		t.Fatalf("unchanged goal status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if rec := postExpenseGoal(t, h, `{"amount":150}`); rec.Code != http.StatusCreated {
		t.Fatalf("changed goal status = %d: %s", rec.Code, rec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM expense_goals WHERE month = ?`, currentMonth).Scan(&count); err != nil {
		t.Fatalf("count goals: %v", err)
	}
	if count != 2 {
		t.Fatalf("goal row count = %d, want 2 (unchanged submission must not insert)", count)
	}
}

func postActualExpense(t *testing.T, h *Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/actual-expenses", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	h.CreateActualExpense(rec, req)
	return rec
}

func getActualExpenseForMonth(t *testing.T, h *Handler, month string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/actual-expenses?month="+month, nil)
	rec := httptest.NewRecorder()
	h.GetActualExpense(rec, req)
	return rec
}

func TestActualExpenseSnapshotsLatest(t *testing.T) {
	h, db := setupTestHandler(t)
	currentMonth := time.Now().Format("2006-01")

	if rec := postActualExpense(t, h, `{"amount":100}`); rec.Code != http.StatusCreated {
		t.Fatalf("first actual status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := postActualExpense(t, h, `{"amount":150}`); rec.Code != http.StatusCreated {
		t.Fatalf("second actual status = %d: %s", rec.Code, rec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM actual_expenses WHERE month = ?`, currentMonth).Scan(&count); err != nil {
		t.Fatalf("count actuals: %v", err)
	}
	if count != 2 {
		t.Fatalf("actual row count = %d, want 2", count)
	}

	rec := getActualExpenseForMonth(t, h, currentMonth)
	if rec.Code != http.StatusOK {
		t.Fatalf("get actual status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Actual *model.ActualExpense `json:"actual"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Actual == nil || out.Actual.Amount != 150 {
		t.Fatalf("latest actual = %+v, want amount 150", out.Actual)
	}
}

func TestCreateActualExpenseRejectsNonPositiveAmount(t *testing.T) {
	h, _ := setupTestHandler(t)
	rec := postActualExpense(t, h, `{"amount":0}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestCreateActualExpenseRejectsUnchangedAmount(t *testing.T) {
	h, db := setupTestHandler(t)
	currentMonth := time.Now().Format("2006-01")

	if rec := postActualExpense(t, h, `{"amount":100}`); rec.Code != http.StatusCreated {
		t.Fatalf("first actual status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := postActualExpense(t, h, `{"amount":100}`); rec.Code != http.StatusConflict {
		t.Fatalf("unchanged actual status = %d, want 409; body=%s", rec.Code, rec.Body.String())
	}
	if rec := postActualExpense(t, h, `{"amount":150}`); rec.Code != http.StatusCreated {
		t.Fatalf("changed actual status = %d: %s", rec.Code, rec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM actual_expenses WHERE month = ?`, currentMonth).Scan(&count); err != nil {
		t.Fatalf("count actuals: %v", err)
	}
	if count != 2 {
		t.Fatalf("actual row count = %d, want 2 (unchanged submission must not insert)", count)
	}
}

func TestUpdateSetsEndMonthToCancel(t *testing.T) {
	h, _ := setupTestHandler(t)
	rec := postExpense(t, h, `{"amount":100,"payment_type":"monthly","start_month":"2026-01"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	var created model.Expense
	json.Unmarshal(rec.Body.Bytes(), &created)

	if rec := putExpense(t, h, created.ID, `{"amount":100,"payment_type":"monthly","end_month":"2026-03"}`); rec.Code != http.StatusOK {
		t.Fatalf("update status = %d: %s", rec.Code, rec.Body.String())
	}
	if f, _ := dashboard(t, h, "2026-04"); f != 0 {
		t.Errorf("after cancel: fixed = %v, want 0", f)
	}
	if f, _ := dashboard(t, h, "2026-03"); f != 100 {
		t.Errorf("through end month: fixed = %v, want 100", f)
	}
}

// Omitting end_month on update must preserve the existing end (pointer = absent),
// while sending an explicit "" clears it (makes the expense ongoing again).
func TestUpdatePreservesThenClearsEndMonth(t *testing.T) {
	h, _ := setupTestHandler(t)
	rec := postExpense(t, h, `{"amount":100,"payment_type":"monthly","start_month":"2026-01","end_month":"2026-03"}`)
	var created model.Expense
	json.Unmarshal(rec.Body.Bytes(), &created)

	// Update amount only — end_month omitted, so it must stay 2026-03.
	putExpense(t, h, created.ID, `{"amount":120,"payment_type":"monthly"}`)
	if f, _ := dashboard(t, h, "2026-04"); f != 0 {
		t.Errorf("end preserved when omitted: fixed = %v, want 0", f)
	}

	// Explicit empty end_month clears the end.
	putExpense(t, h, created.ID, `{"amount":120,"payment_type":"monthly","end_month":""}`)
	if f, _ := dashboard(t, h, "2026-04"); f != 120 {
		t.Errorf("end cleared by empty string: fixed = %v, want 120", f)
	}
}
