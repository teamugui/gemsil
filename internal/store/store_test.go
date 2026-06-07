package store

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"
)

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
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	var name string
	if err := s.db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'expense_goals'`).Scan(&name); err != nil {
		t.Fatalf("expense_goals table: %v", err)
	}
	if name != "expense_goals" {
		t.Fatalf("table name = %q, want expense_goals", name)
	}
}

func TestSchemaCreatesActualExpenses(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	var name string
	if err := s.db.QueryRow(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'actual_expenses'`).Scan(&name); err != nil {
		t.Fatalf("actual_expenses table: %v", err)
	}
	if name != "actual_expenses" {
		t.Fatalf("table name = %q, want actual_expenses", name)
	}
}

// seedGoal/seedActual append a snapshot directly, mirroring the append-only
// CreateExpenseGoal/CreateActualExpense writes.
func seedGoal(t *testing.T, s *Store, month string, amount float64) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO expense_goals (month, amount, created_at) VALUES (?, ?, ?)`,
		month, amount, month+"-01T00:00:00Z"); err != nil {
		t.Fatalf("seed goal: %v", err)
	}
}

func seedActual(t *testing.T, s *Store, month string, amount float64) {
	t.Helper()
	if _, err := s.db.Exec(`INSERT INTO actual_expenses (month, amount, created_at) VALUES (?, ?, ?)`,
		month, amount, month+"-01T00:00:00Z"); err != nil {
		t.Fatalf("seed actual: %v", err)
	}
}

// CumulativeSavings sums (latest goal − latest actual) over every month up to and
// including throughMonth that has both snapshots: later snapshots win, partial
// months and months after throughMonth are excluded.
func TestCumulativeSavingsThroughMonth(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	seedGoal(t, s, "2026-01", 300)
	seedActual(t, s, "2026-01", 250) // +50

	seedGoal(t, s, "2026-02", 200)
	seedGoal(t, s, "2026-02", 220)   // later snapshot wins
	seedActual(t, s, "2026-02", 100) // +120

	seedGoal(t, s, "2026-03", 100) // goal only → excluded

	seedGoal(t, s, "2026-04", 500)
	seedActual(t, s, "2026-04", 400) // after throughMonth → excluded

	got, err := s.CumulativeSavings("2026-03")
	if err != nil {
		t.Fatalf("CumulativeSavings: %v", err)
	}
	if got == nil {
		t.Fatalf("CumulativeSavings = nil, want 170")
	}
	if *got != 170 {
		t.Fatalf("CumulativeSavings = %v, want 170", *got)
	}
}

func TestCumulativeSavingsNilWhenNoQualifyingMonth(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	seedGoal(t, s, "2026-01", 300)   // goal only
	seedActual(t, s, "2026-02", 100) // actual only, different month

	got, err := s.CumulativeSavings("2026-12")
	if err != nil {
		t.Fatalf("CumulativeSavings: %v", err)
	}
	if got != nil {
		t.Fatalf("CumulativeSavings = %v, want nil", *got)
	}
}

// seedMerchant appends a one-time expense with the given merchant and date,
// used to exercise the merchant-suggestion query.
func seedMerchant(t *testing.T, s *Store, merchant, date string) {
	t.Helper()
	if _, err := s.db.Exec(
		`INSERT INTO expenses (amount, merchant, description, payment_type, date, created_at, start_month)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		100, merchant, "", "once", date, date+"T00:00:00Z", date[:7]); err != nil {
		t.Fatalf("seed merchant: %v", err)
	}
}

func TestSuggestMerchants(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	seedMerchant(t, s, "스타벅스", "2026-01-01")
	seedMerchant(t, s, "스타벅스", "2026-01-02")
	seedMerchant(t, s, "스타벅스", "2026-01-03") // 3x → most used
	seedMerchant(t, s, "스타벅스 강남", "2026-02-01")
	seedMerchant(t, s, "투썸플레이스", "2026-02-02")
	seedMerchant(t, s, "", "2026-02-03")   // empty → excluded
	seedMerchant(t, s, "  ", "2026-02-04") // whitespace-only → excluded

	// Substring match, most-used first.
	got, err := s.SuggestMerchants("스타", 8)
	if err != nil {
		t.Fatalf("SuggestMerchants: %v", err)
	}
	want := []string{"스타벅스", "스타벅스 강남"}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("SuggestMerchants(\"스타\") = %v, want %v", got, want)
	}

	// Empty/whitespace merchants must never be suggested.
	if got, err := s.SuggestMerchants("", 8); err != nil {
		t.Fatalf("SuggestMerchants(empty): %v", err)
	} else {
		for _, m := range got {
			if strings.TrimSpace(m) == "" {
				t.Fatalf("SuggestMerchants returned empty merchant: %q", m)
			}
		}
	}

	// limit caps the number of results.
	if got, err := s.SuggestMerchants("스", 1); err != nil {
		t.Fatalf("SuggestMerchants(limit 1): %v", err)
	} else if len(got) != 1 {
		t.Fatalf("SuggestMerchants(limit 1) returned %d rows, want 1", len(got))
	}
}

// LIKE wildcards in the query must be matched literally, not as patterns.
func TestSuggestMerchantsEscapesWildcards(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer s.Close()

	seedMerchant(t, s, "50%할인마트", "2026-01-01")
	seedMerchant(t, s, "5050편의점", "2026-01-02")

	got, err := s.SuggestMerchants("50%", 8)
	if err != nil {
		t.Fatalf("SuggestMerchants: %v", err)
	}
	if len(got) != 1 || got[0] != "50%할인마트" {
		t.Fatalf("SuggestMerchants(\"50%%\") = %v, want [50%%할인마트] (literal %% match)", got)
	}
}
