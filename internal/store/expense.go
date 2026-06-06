package store

import (
	"database/sql"
	"errors"

	"gemsil/internal/model"
)

// scanner is satisfied by both *sql.Row and *sql.Rows.
type scanner interface {
	Scan(dest ...any) error
}

// expenseColumns is the canonical column list/order for reading an expense.
const expenseColumns = `id, amount, merchant, description, payment_type, date, created_at, start_month, end_month`

// scanExpense reads one expense row in expenseColumns order, mapping the
// nullable month columns to empty strings.
func scanExpense(sc scanner) (model.Expense, error) {
	var e model.Expense
	var start, end sql.NullString
	if err := sc.Scan(&e.ID, &e.Amount, &e.Merchant, &e.Description, &e.PaymentType, &e.Date, &e.CreatedAt, &start, &end); err != nil {
		return model.Expense{}, err
	}
	e.StartMonth, e.EndMonth = start.String, end.String
	return e, nil
}

// CreateExpense inserts e and returns its new ID. The caller supplies all fields
// (date, created_at, effective range); an empty EndMonth is stored as NULL.
func (s *Store) CreateExpense(e model.Expense) (int64, error) {
	res, err := s.db.Exec(
		`INSERT INTO expenses (amount, merchant, description, payment_type, date, created_at, start_month, end_month)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		e.Amount, e.Merchant, e.Description, e.PaymentType, e.Date, e.CreatedAt, e.StartMonth, nullableMonth(e.EndMonth),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// ListExpenses returns all expenses, newest first. A non-empty typeFilter limits
// the result to that payment_type.
func (s *Store) ListExpenses(typeFilter string) ([]model.Expense, error) {
	q := `SELECT ` + expenseColumns + ` FROM expenses`
	var args []any
	if typeFilter != "" {
		q += " WHERE payment_type = ?"
		args = append(args, typeFilter)
	}
	q += " ORDER BY date DESC, id DESC"

	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	expenses := []model.Expense{}
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			return nil, err
		}
		expenses = append(expenses, e)
	}
	return expenses, rows.Err()
}

// GetExpense returns the expense with the given id. The boolean is false when no
// such row exists.
func (s *Store) GetExpense(id int64) (model.Expense, bool, error) {
	e, err := scanExpense(s.db.QueryRow(`SELECT `+expenseColumns+` FROM expenses WHERE id = ?`, id))
	if errors.Is(err, sql.ErrNoRows) {
		return model.Expense{}, false, nil
	}
	if err != nil {
		return model.Expense{}, false, err
	}
	return e, true, nil
}

// UpdateExpense overwrites the mutable fields of the expense with the given id.
func (s *Store) UpdateExpense(id int64, e model.Expense) error {
	_, err := s.db.Exec(
		`UPDATE expenses
		 SET amount = ?, merchant = ?, description = ?, payment_type = ?, start_month = ?, end_month = ?
		 WHERE id = ?`,
		e.Amount, e.Merchant, e.Description, e.PaymentType, e.StartMonth, nullableMonth(e.EndMonth), id,
	)
	return err
}

// DeleteExpense removes the expense with the given id. The boolean is false when
// no row matched.
func (s *Store) DeleteExpense(id int64) (bool, error) {
	res, err := s.db.Exec(`DELETE FROM expenses WHERE id = ?`, id)
	if err != nil {
		return false, err
	}
	n, _ := res.RowsAffected()
	return n > 0, nil
}

// ActiveExpenses returns every expense whose effective range covers the month ym
// ("YYYY-MM"), newest first. Recurring rows count within [start_month, end_month]
// (end inclusive; NULL = ongoing); one-time rows also satisfy this window and are
// narrowed to their exact month by the caller.
func (s *Store) ActiveExpenses(ym string) ([]model.Expense, error) {
	rows, err := s.db.Query(
		`SELECT `+expenseColumns+`
		 FROM expenses
		 WHERE start_month <= ? AND (end_month IS NULL OR ? <= end_month)
		 ORDER BY date DESC, id DESC`,
		ym, ym,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	expenses := []model.Expense{}
	for rows.Next() {
		e, err := scanExpense(rows)
		if err != nil {
			return nil, err
		}
		expenses = append(expenses, e)
	}
	return expenses, rows.Err()
}

// EarliestExpenseMonth returns the earliest "YYYY-MM" any expense was dated in,
// or "" when there are no expenses.
func (s *Store) EarliestExpenseMonth() (string, error) {
	var earliest sql.NullString
	if err := s.db.QueryRow(`SELECT MIN(substr(date, 1, 7)) FROM expenses`).Scan(&earliest); err != nil {
		return "", err
	}
	return earliest.String, nil
}
