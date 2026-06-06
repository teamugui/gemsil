package main

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
)

// setupTestDB points the package-global db at a fresh temporary database.
func setupTestDB(t *testing.T) {
	t.Helper()
	d, err := openDB(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("openDB: %v", err)
	}
	db = d
	t.Cleanup(func() { d.Close() })
}

// insertRecurring inserts a recurring expense with an explicit effective range.
// end == "" stores SQL NULL (ongoing).
func insertRecurring(t *testing.T, amount float64, ptype, startMonth, end string) {
	t.Helper()
	date := startMonth + "-01"
	if _, err := db.Exec(
		`INSERT INTO expenses (amount, merchant, description, payment_type, date, created_at, start_month, end_month)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		amount, "m", "d", ptype, date, date+"T00:00:00Z", startMonth, nullableMonth(end),
	); err != nil {
		t.Fatalf("insert: %v", err)
	}
}

// dashboard returns the (fixed, variable) totals the dashboard reports for ym.
func dashboard(t *testing.T, ym string) (fixed, variable float64) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month="+ym, nil)
	rec := httptest.NewRecorder()
	dashboardSummary(rec, req)
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

// TestMigrationAddsColumnsAndBackfills simulates a database created before the
// start_month/end_month columns existed and verifies applySchema migrates it.
func TestMigrationAddsColumnsAndBackfills(t *testing.T) {
	d, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "old.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.Exec(`CREATE TABLE expenses (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		amount REAL NOT NULL, merchant TEXT, description TEXT,
		payment_type TEXT NOT NULL, date TEXT NOT NULL, created_at TEXT NOT NULL
	)`); err != nil {
		t.Fatal(err)
	}
	if _, err := d.Exec(`INSERT INTO expenses (amount, payment_type, date, created_at)
		VALUES (100, 'monthly', '2026-01-15', '2026-01-15T00:00:00Z')`); err != nil {
		t.Fatal(err)
	}

	if err := applySchema(d); err != nil {
		t.Fatalf("applySchema: %v", err)
	}
	var start, end sql.NullString
	if err := d.QueryRow(`SELECT start_month, end_month FROM expenses WHERE id = 1`).Scan(&start, &end); err != nil {
		t.Fatalf("query: %v", err)
	}
	if start.String != "2026-01" {
		t.Errorf("start_month backfill = %q, want 2026-01", start.String)
	}
	if end.Valid {
		t.Errorf("end_month = %q, want NULL", end.String)
	}

	// Idempotent: re-running must not error (duplicate-column is ignored).
	if err := applySchema(d); err != nil {
		t.Fatalf("second applySchema: %v", err)
	}
}

func TestSchemaCreatesExpenseGoals(t *testing.T) {
	setupTestDB(t)

	var name string
	if err := db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expense_goals'`).Scan(&name); err != nil {
		t.Fatalf("expense_goals table: %v", err)
	}
	if name != "expense_goals" {
		t.Fatalf("table name = %q, want expense_goals", name)
	}
}

func TestDashboardOngoingMonthlyCarriesForward(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 100, "monthly", "2026-01", "")

	if f, _ := dashboard(t, "2025-12"); f != 0 {
		t.Errorf("before start: fixed = %v, want 0", f)
	}
	if f, _ := dashboard(t, "2026-01"); f != 100 {
		t.Errorf("start month: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, "2026-09"); f != 100 {
		t.Errorf("later month: fixed = %v, want 100", f)
	}
}

func TestDashboardEndMonthStopsAfterInclusive(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 100, "monthly", "2026-01", "2026-03")

	if f, _ := dashboard(t, "2026-03"); f != 100 {
		t.Errorf("end month is inclusive: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, "2026-04"); f != 0 {
		t.Errorf("after end: fixed = %v, want 0", f)
	}
}

func TestDashboardAnnualProrated(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 1200, "annual", "2026-01", "")
	if f, _ := dashboard(t, "2026-05"); f != 100 {
		t.Errorf("annual prorated: fixed = %v, want 100", f)
	}
}

func TestDashboardOnceCountsOnlyItsMonth(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 50, "once", "2026-02", "") // helper sets date 2026-02-01
	if _, v := dashboard(t, "2026-02"); v != 50 {
		t.Errorf("its month: variable = %v, want 50", v)
	}
	if _, v := dashboard(t, "2026-03"); v != 0 {
		t.Errorf("other month: variable = %v, want 0", v)
	}
}

// An amount change is modeled as "end the old row, start a new one the next
// month". The two rows must tile the timeline with no gap and no overlap.
func TestDashboardAmountChangeNoOverlap(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 100, "monthly", "2026-01", "2026-05")
	insertRecurring(t, 110, "monthly", "2026-06", "")

	if f, _ := dashboard(t, "2026-05"); f != 100 {
		t.Errorf("last old month: fixed = %v, want 100", f)
	}
	if f, _ := dashboard(t, "2026-06"); f != 110 {
		t.Errorf("first new month: fixed = %v, want 110 (no double count)", f)
	}
}

func TestDashboardIncludesGoalProgress(t *testing.T) {
	setupTestDB(t)
	insertRecurring(t, 100, "monthly", "2026-01", "")
	if _, err := db.Exec(
		`INSERT INTO expense_goals (month, amount, created_at) VALUES (?, ?, ?)`,
		"2026-01", 250.0, "2026-01-02T00:00:00Z",
	); err != nil {
		t.Fatalf("insert goal: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	dashboardSummary(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		GoalAmount    *float64 `json:"goal_amount"`
		Remaining     *float64 `json:"remaining_amount"`
		GoalUsageRate *float64 `json:"goal_usage_rate"`
		GoalCreatedAt *string  `json:"goal_created_at"`
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
}

func TestDashboardGoalFieldsNullWhenUnset(t *testing.T) {
	setupTestDB(t)
	req := httptest.NewRequest(http.MethodGet, "/api/dashboard?month=2026-01", nil)
	rec := httptest.NewRecorder()
	dashboardSummary(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("dashboard status %d: %s", rec.Code, rec.Body.String())
	}

	var out struct {
		GoalAmount *float64 `json:"goal_amount"`
		Remaining  *float64 `json:"remaining_amount"`
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
}

// --- handler tests -------------------------------------------------------

func postExpense(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/expenses", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	createExpense(rec, req)
	return rec
}

func putExpense(t *testing.T, id int64, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPut, "/api/expenses/"+strconv.FormatInt(id, 10), bytes.NewBufferString(body))
	rctx := chi.NewRouteContext()
	rctx.URLParams.Add("id", strconv.FormatInt(id, 10))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, rctx))
	rec := httptest.NewRecorder()
	updateExpense(rec, req)
	return rec
}

func postExpenseGoal(t *testing.T, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/expense-goals", bytes.NewBufferString(body))
	rec := httptest.NewRecorder()
	createExpenseGoal(rec, req)
	return rec
}

func getExpenseGoalForMonth(t *testing.T, month string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/expense-goals?month="+month, nil)
	rec := httptest.NewRecorder()
	getExpenseGoal(rec, req)
	return rec
}

func TestCreateRejectsEndBeforeStart(t *testing.T) {
	setupTestDB(t)
	rec := postExpense(t, `{"amount":100,"payment_type":"monthly","start_month":"2026-05","end_month":"2026-03"}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestExpenseGoalSnapshotsLatest(t *testing.T) {
	setupTestDB(t)
	currentMonth := time.Now().Format("2006-01")

	if rec := postExpenseGoal(t, `{"amount":100}`); rec.Code != http.StatusCreated {
		t.Fatalf("first goal status = %d: %s", rec.Code, rec.Body.String())
	}
	if rec := postExpenseGoal(t, `{"amount":150}`); rec.Code != http.StatusCreated {
		t.Fatalf("second goal status = %d: %s", rec.Code, rec.Body.String())
	}

	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM expense_goals WHERE month = ?`, currentMonth).Scan(&count); err != nil {
		t.Fatalf("count goals: %v", err)
	}
	if count != 2 {
		t.Fatalf("goal row count = %d, want 2", count)
	}

	rec := getExpenseGoalForMonth(t, currentMonth)
	if rec.Code != http.StatusOK {
		t.Fatalf("get goal status = %d: %s", rec.Code, rec.Body.String())
	}
	var out struct {
		Goal *ExpenseGoal `json:"goal"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if out.Goal == nil || out.Goal.Amount != 150 {
		t.Fatalf("latest goal = %+v, want amount 150", out.Goal)
	}
}

func TestCreateExpenseGoalRejectsNonPositiveAmount(t *testing.T) {
	setupTestDB(t)
	rec := postExpenseGoal(t, `{"amount":0}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
}

func TestUpdateSetsEndMonthToCancel(t *testing.T) {
	setupTestDB(t)
	rec := postExpense(t, `{"amount":100,"payment_type":"monthly","start_month":"2026-01"}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create status = %d: %s", rec.Code, rec.Body.String())
	}
	var created Expense
	json.Unmarshal(rec.Body.Bytes(), &created)

	if rec := putExpense(t, created.ID, `{"amount":100,"payment_type":"monthly","end_month":"2026-03"}`); rec.Code != http.StatusOK {
		t.Fatalf("update status = %d: %s", rec.Code, rec.Body.String())
	}
	if f, _ := dashboard(t, "2026-04"); f != 0 {
		t.Errorf("after cancel: fixed = %v, want 0", f)
	}
	if f, _ := dashboard(t, "2026-03"); f != 100 {
		t.Errorf("through end month: fixed = %v, want 100", f)
	}
}

// Omitting end_month on update must preserve the existing end (pointer = absent),
// while sending an explicit "" clears it (makes the expense ongoing again).
func TestUpdatePreservesThenClearsEndMonth(t *testing.T) {
	setupTestDB(t)
	rec := postExpense(t, `{"amount":100,"payment_type":"monthly","start_month":"2026-01","end_month":"2026-03"}`)
	var created Expense
	json.Unmarshal(rec.Body.Bytes(), &created)

	// Update amount only — end_month omitted, so it must stay 2026-03.
	putExpense(t, created.ID, `{"amount":120,"payment_type":"monthly"}`)
	if f, _ := dashboard(t, "2026-04"); f != 0 {
		t.Errorf("end preserved when omitted: fixed = %v, want 0", f)
	}

	// Explicit empty end_month clears the end.
	putExpense(t, created.ID, `{"amount":120,"payment_type":"monthly","end_month":""}`)
	if f, _ := dashboard(t, "2026-04"); f != 120 {
		t.Errorf("end cleared by empty string: fixed = %v, want 120", f)
	}
}
