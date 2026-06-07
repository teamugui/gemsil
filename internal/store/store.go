// Package store is gemsil's data-access layer. A Store wraps a *sql.DB and owns
// every SQL statement in the application; higher layers depend on its methods
// rather than touching the database directly.
package store

import (
	"database/sql"
	"strings"

	_ "modernc.org/sqlite"
)

// Store provides typed access to gemsil's SQLite database.
type Store struct {
	db *sql.DB
}

// Open opens the SQLite database at dsn and ensures its schema is current.
func Open(dsn string) (*Store, error) {
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	return New(d)
}

// New wraps an already-open *sql.DB, applying the schema migrations. It is the
// seam tests use to back a Store with their own database handle.
func New(d *sql.DB) (*Store, error) {
	if err := applySchema(d); err != nil {
		return nil, err
	}
	return &Store{db: d}, nil
}

// Close closes the underlying database.
func (s *Store) Close() error { return s.db.Close() }

// applySchema creates the tables if needed and migrates older databases that
// predate the start_month/end_month columns. It is idempotent.
func applySchema(d *sql.DB) error {
	schema := `
CREATE TABLE IF NOT EXISTS expenses (
	id           INTEGER PRIMARY KEY AUTOINCREMENT,
	amount       REAL NOT NULL,
	merchant     TEXT,
	description  TEXT,
	payment_type TEXT NOT NULL,
	date         TEXT NOT NULL,
	created_at   TEXT NOT NULL,
	start_month  TEXT,
	end_month    TEXT
);
CREATE TABLE IF NOT EXISTS settings (
	key   TEXT PRIMARY KEY,
	value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS expense_goals (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	month      TEXT NOT NULL,
	amount     REAL NOT NULL CHECK(amount > 0),
	created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS actual_expenses (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	month      TEXT NOT NULL,
	amount     REAL NOT NULL CHECK(amount > 0),
	created_at TEXT NOT NULL
);`
	if _, err := d.Exec(schema); err != nil {
		return err
	}
	// For databases created before these columns existed, CREATE TABLE IF NOT
	// EXISTS is a no-op, so add the columns explicitly. On fresh databases the
	// columns already exist and ALTER fails with "duplicate column name" — ignore
	// only that error.
	for _, col := range []string{"start_month", "end_month"} {
		if _, err := d.Exec("ALTER TABLE expenses ADD COLUMN " + col + " TEXT"); err != nil {
			if !strings.Contains(err.Error(), "duplicate column name") {
				return err
			}
		}
	}
	// Backfill the effective start month for rows that predate the column.
	if _, err := d.Exec(`UPDATE expenses SET start_month = substr(date, 1, 7)
		WHERE start_month IS NULL OR start_month = ''`); err != nil {
		return err
	}
	return nil
}

// nullableMonth maps an empty month string to a SQL NULL, else the month itself.
func nullableMonth(m string) any {
	if m == "" {
		return nil
	}
	return m
}
