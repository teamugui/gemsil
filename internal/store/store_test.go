package store

import (
	"database/sql"
	"path/filepath"
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
