package store

import (
	"database/sql"
	"errors"

	"gemsil/internal/model"
)

// LatestExpenseGoal returns the most recent goal snapshot for month, or nil when
// none has been set.
func (s *Store) LatestExpenseGoal(month string) (*model.ExpenseGoal, error) {
	var g model.ExpenseGoal
	err := s.db.QueryRow(
		`SELECT id, month, amount, created_at
		 FROM expense_goals
		 WHERE month = ?
		 ORDER BY id DESC
		 LIMIT 1`,
		month,
	).Scan(&g.ID, &g.Month, &g.Amount, &g.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// ListExpenseGoalHistory returns every goal snapshot for month, newest first.
func (s *Store) ListExpenseGoalHistory(month string) ([]model.ExpenseGoal, error) {
	rows, err := s.db.Query(
		`SELECT id, month, amount, created_at
		 FROM expense_goals
		 WHERE month = ?
		 ORDER BY id DESC`,
		month,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	goals := []model.ExpenseGoal{}
	for rows.Next() {
		var g model.ExpenseGoal
		if err := rows.Scan(&g.ID, &g.Month, &g.Amount, &g.CreatedAt); err != nil {
			return nil, err
		}
		goals = append(goals, g)
	}
	return goals, rows.Err()
}

// CreateExpenseGoal appends a goal snapshot and returns its new ID.
func (s *Store) CreateExpenseGoal(g model.ExpenseGoal) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO expense_goals (month, amount, created_at)
		 VALUES (?, ?, ?)`,
		g.Month, g.Amount, g.CreatedAt,
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}
