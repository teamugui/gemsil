package store

import (
	"database/sql"
	"errors"

	"gemsil/internal/model"
)

// LatestActualExpense returns the most recent actual-spending snapshot for
// month, or nil when none has been recorded.
func (s *Store) LatestActualExpense(month string) (*model.ActualExpense, error) {
	var a model.ActualExpense
	err := s.db.QueryRow(
		`SELECT id, month, amount, created_at
		 FROM actual_expenses
		 WHERE month = ?
		 ORDER BY id DESC
		 LIMIT 1`,
		month,
	).Scan(&a.ID, &a.Month, &a.Amount, &a.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &a, nil
}

// ListActualExpenseHistory returns every actual-spending snapshot for month,
// newest first.
func (s *Store) ListActualExpenseHistory(month string) ([]model.ActualExpense, error) {
	rows, err := s.db.Query(
		`SELECT id, month, amount, created_at
		 FROM actual_expenses
		 WHERE month = ?
		 ORDER BY id DESC`,
		month,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	actuals := []model.ActualExpense{}
	for rows.Next() {
		var a model.ActualExpense
		if err := rows.Scan(&a.ID, &a.Month, &a.Amount, &a.CreatedAt); err != nil {
			return nil, err
		}
		actuals = append(actuals, a)
	}
	return actuals, rows.Err()
}

// CreateActualExpense appends an actual-spending snapshot and returns its new ID.
func (s *Store) CreateActualExpense(a model.ActualExpense) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO actual_expenses (month, amount, created_at)
		 VALUES (?, ?, ?)`,
		a.Month, a.Amount, a.CreatedAt,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
