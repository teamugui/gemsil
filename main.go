// gemsil — a manual-entry personal budget tracker.
//
// Single self-contained binary: HTML templates and static assets are embedded
// via go:embed, and the SQLite database file is created next to the binary.
package main

import (
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	_ "modernc.org/sqlite"
)

// ---------------------------------------------------------------------------
// Embedded assets
// ---------------------------------------------------------------------------

//go:embed templates/*.html
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS

var tmpl = template.Must(template.ParseFS(templatesFS, "templates/*.html"))

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

var db *sql.DB

// allowedTypes is the set of valid payment_type values.
var allowedTypes = map[string]bool{"once": true, "monthly": true, "annual": true}

func initDB() error {
	var err error
	db, err = openDB("gemsil.db")
	return err
}

// openDB opens the SQLite database at dsn and ensures its schema is current.
func openDB(dsn string) (*sql.DB, error) {
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	if err := applySchema(d); err != nil {
		return nil, err
	}
	return d, nil
}

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

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

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

// DashboardItem is one line in the current month's expense list.
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

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func getSetting(key string) (string, error) {
	var v string
	err := db.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return v, err
}

// ---------------------------------------------------------------------------
// Expense handlers
// ---------------------------------------------------------------------------

func createExpense(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount      float64 `json:"amount"`
		Merchant    string  `json:"merchant"`
		Description string  `json:"description"`
		PaymentType string  `json:"payment_type"`
		StartMonth  string  `json:"start_month"` // optional; recurring effective start
		EndMonth    string  `json:"end_month"`   // optional; recurring effective end (inclusive)
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "금액은 0보다 커야 합니다.")
		return
	}
	if !allowedTypes[in.PaymentType] {
		httpError(w, http.StatusBadRequest, "결제 유형이 올바르지 않습니다.")
		return
	}

	// The date is always set by the server to today — never client-supplied.
	now := time.Now()
	date := now.Format("2006-01-02")
	createdAt := now.Format(time.RFC3339)
	currentMonth := now.Format("2006-01")

	// One-time expenses are pinned to their own month; recurring ones may start in
	// a chosen month (defaulting to the current one) and optionally end later.
	startMonth, endMonth := currentMonth, ""
	if in.PaymentType != "once" {
		if in.StartMonth != "" {
			startMonth = in.StartMonth
		}
		endMonth = in.EndMonth
	}
	if msg := validateMonthRange(in.PaymentType, startMonth, endMonth); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	res, err := db.Exec(
		`INSERT INTO expenses (amount, merchant, description, payment_type, date, created_at, start_month, end_month)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		in.Amount, in.Merchant, in.Description, in.PaymentType, date, createdAt, startMonth, nullableMonth(endMonth),
	)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusCreated, Expense{
		ID: id, Amount: in.Amount, Merchant: in.Merchant, Description: in.Description,
		PaymentType: in.PaymentType, Date: date, CreatedAt: createdAt,
		StartMonth: startMonth, EndMonth: endMonth,
	})
}

func listExpenses(w http.ResponseWriter, r *http.Request) {
	q := `SELECT id, amount, merchant, description, payment_type, date, created_at, start_month, end_month FROM expenses`
	var args []any
	if t := r.URL.Query().Get("type"); allowedTypes[t] {
		q += " WHERE payment_type = ?"
		args = append(args, t)
	}
	q += " ORDER BY date DESC, id DESC"

	rows, err := db.Query(q, args...)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	defer rows.Close()

	expenses := []Expense{}
	for rows.Next() {
		var e Expense
		var start, end sql.NullString
		if err := rows.Scan(&e.ID, &e.Amount, &e.Merchant, &e.Description, &e.PaymentType, &e.Date, &e.CreatedAt, &start, &end); err != nil {
			httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
			return
		}
		e.StartMonth, e.EndMonth = start.String, end.String
		expenses = append(expenses, e)
	}
	writeJSON(w, http.StatusOK, expenses)
}

func expenseIDFromRequest(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	return id, err == nil && id > 0
}

func updateExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := expenseIDFromRequest(r)
	if !ok {
		httpError(w, http.StatusBadRequest, "지출 ID가 올바르지 않습니다.")
		return
	}

	var in struct {
		Amount      float64 `json:"amount"`
		Merchant    string  `json:"merchant"`
		Description string  `json:"description"`
		PaymentType string  `json:"payment_type"`
		// Pointers distinguish "absent" (keep existing) from an explicit value.
		// EndMonth set to "" clears the end (makes the expense ongoing again).
		StartMonth *string `json:"start_month"`
		EndMonth   *string `json:"end_month"`
	}
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	if in.Amount <= 0 {
		httpError(w, http.StatusBadRequest, "금액은 0보다 커야 합니다.")
		return
	}
	if !allowedTypes[in.PaymentType] {
		httpError(w, http.StatusBadRequest, "결제 유형이 올바르지 않습니다.")
		return
	}

	// Load the current effective range to use as the baseline for partial updates.
	var (
		curDate          string
		curStart, curEnd sql.NullString
	)
	err := db.QueryRow(
		`SELECT date, start_month, end_month FROM expenses WHERE id = ?`, id,
	).Scan(&curDate, &curStart, &curEnd)
	if errors.Is(err, sql.ErrNoRows) {
		httpError(w, http.StatusNotFound, "지출 내역을 찾을 수 없습니다.")
		return
	}
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}

	startMonth, endMonth := resolveMonthRange(in.PaymentType, curDate, curStart.String, curEnd.String, in.StartMonth, in.EndMonth)
	if msg := validateMonthRange(in.PaymentType, startMonth, endMonth); msg != "" {
		httpError(w, http.StatusBadRequest, msg)
		return
	}

	if _, err := db.Exec(
		`UPDATE expenses
		 SET amount = ?, merchant = ?, description = ?, payment_type = ?, start_month = ?, end_month = ?
		 WHERE id = ?`,
		in.Amount, in.Merchant, in.Description, in.PaymentType, startMonth, nullableMonth(endMonth), id,
	); err != nil {
		httpError(w, http.StatusInternalServerError, "수정에 실패했습니다.")
		return
	}

	var e Expense
	var start, end sql.NullString
	err = db.QueryRow(
		`SELECT id, amount, merchant, description, payment_type, date, created_at, start_month, end_month
		 FROM expenses
		 WHERE id = ?`,
		id,
	).Scan(&e.ID, &e.Amount, &e.Merchant, &e.Description, &e.PaymentType, &e.Date, &e.CreatedAt, &start, &end)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	e.StartMonth, e.EndMonth = start.String, end.String
	writeJSON(w, http.StatusOK, e)
}

// resolveMonthRange computes the effective start/end months for an update. One-time
// expenses are always pinned to their own month with no end. For recurring ones,
// nil inputs keep the current value (falling back to the registration month when
// unset); a non-nil pointer overrides, and EndMonth="" clears the end.
func resolveMonthRange(ptype, date, curStart, curEnd string, startIn, endIn *string) (start, end string) {
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

func deleteExpense(w http.ResponseWriter, r *http.Request) {
	id, ok := expenseIDFromRequest(r)
	if !ok {
		httpError(w, http.StatusBadRequest, "지출 ID가 올바르지 않습니다.")
		return
	}

	res, err := db.Exec(`DELETE FROM expenses WHERE id = ?`, id)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "삭제에 실패했습니다.")
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		httpError(w, http.StatusNotFound, "지출 내역을 찾을 수 없습니다.")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// dashboardSummary computes the current month's totals using a virtual/computed
// model: recurring expenses are stored once and their monthly contribution is
// derived here. A recurring expense counts for every month from its start month
// onward (monthly at full amount, annual prorated as amount/12). One-time
// expenses count only in the month they were entered.
func dashboardSummary(w http.ResponseWriter, r *http.Request) {
	currency, _ := getSetting("currency")
	currentYM := time.Now().Format("2006-01")

	// The viewed month defaults to the current one; a ?month=YYYY-MM query
	// param selects a different period. Invalid values fall back to current.
	ym := currentYM
	if m := r.URL.Query().Get("month"); validYearMonth(m) {
		ym = m
	}

	// Recurring expenses count only within their effective range [start_month,
	// end_month] (end inclusive; NULL = ongoing). One-time rows also satisfy this
	// window and are narrowed to their exact month below.
	rows, err := db.Query(
		`SELECT id, amount, merchant, description, payment_type, date, created_at, start_month, end_month
		 FROM expenses
		 WHERE start_month <= ? AND (end_month IS NULL OR ? <= end_month)
		 ORDER BY date DESC, id DESC`,
		ym, ym,
	)
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	defer rows.Close()

	var fixed, variable float64
	items := []DashboardItem{}
	for rows.Next() {
		var (
			id          int64
			amount      float64
			merchant    string
			description string
			ptype       string
			date        string
			createdAt   string
			start, end  sql.NullString
		)
		if err := rows.Scan(&id, &amount, &merchant, &description, &ptype, &date, &createdAt, &start, &end); err != nil {
			httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
			return
		}

		switch ptype {
		case "once":
			// One-time expenses only count in the month they happened.
			if strings.HasPrefix(date, ym) {
				variable += amount
				items = append(items, DashboardItem{
					ID: id, Category: "variable", PaymentType: ptype,
					Merchant: merchant, Description: description, Amount: amount, Date: date,
					CreatedAt: createdAt,
				})
			}
		case "monthly":
			fixed += amount
			items = append(items, DashboardItem{
				ID: id, Category: "fixed", PaymentType: ptype,
				Merchant: merchant, Description: description, Amount: amount, Date: date,
				CreatedAt: createdAt, StartMonth: start.String, EndMonth: end.String,
			})
		case "annual":
			prorated := amount / 12
			fixed += prorated
			items = append(items, DashboardItem{
				ID: id, Category: "fixed", PaymentType: ptype,
				Merchant: merchant, Description: description, Amount: prorated, FullAmount: amount, Date: date,
				CreatedAt: createdAt, StartMonth: start.String, EndMonth: end.String,
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"currency": currency,
		"month":    ym,
		"months":   availableMonths(currentYM),
		"fixed":    fixed,
		"variable": variable,
		"total":    fixed + variable,
		"items":    items,
	})
}

// validYearMonth reports whether s is a well-formed "YYYY-MM" period.
func validYearMonth(s string) bool {
	_, err := time.Parse("2006-01", s)
	return err == nil
}

// validateMonthRange checks a recurring expense's effective range. start must be
// a valid "YYYY-MM"; end may be empty ("ongoing") or a valid month not earlier
// than start. One-time expenses have no end. Returns a Korean error message when
// invalid, or "" when valid. (Lexicographic compare is correct for "YYYY-MM".)
func validateMonthRange(ptype, start, end string) string {
	if !validYearMonth(start) {
		return "시작 월 형식이 올바르지 않습니다."
	}
	if ptype == "once" || end == "" {
		return ""
	}
	if !validYearMonth(end) {
		return "종료 월 형식이 올바르지 않습니다."
	}
	if end < start {
		return "종료 월은 시작 월보다 빠를 수 없습니다."
	}
	return ""
}

// nullableMonth maps an empty month string to a SQL NULL, else the month itself.
func nullableMonth(m string) any {
	if m == "" {
		return nil
	}
	return m
}

// availableMonths lists every "YYYY-MM" period the dashboard can show — from the
// earliest expense month through the current month (inclusive), newest first.
// Recurring expenses make every month in this contiguous range meaningful.
func availableMonths(currentYM string) []string {
	var earliest sql.NullString
	_ = db.QueryRow(`SELECT MIN(substr(date, 1, 7)) FROM expenses`).Scan(&earliest)

	start := currentYM
	if earliest.Valid && earliest.String != "" && earliest.String < currentYM {
		start = earliest.String
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

// ---------------------------------------------------------------------------
// Settings handlers
// ---------------------------------------------------------------------------

func getSettings(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT key, value FROM settings")
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	defer rows.Close()

	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
			return
		}
		settings[k] = v
	}
	writeJSON(w, http.StatusOK, settings)
}

// saveSettings accepts either a {"key":..,"value":..} pair or a flat object of
// settings. The currency is immutable: once set, attempting to change it returns
// 409 Conflict.
func saveSettings(w http.ResponseWriter, r *http.Request) {
	var raw map[string]string
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		httpError(w, http.StatusBadRequest, "잘못된 요청 형식입니다.")
		return
	}
	// Normalize the {key,value} form into the flat form.
	if k, ok := raw["key"]; ok {
		raw = map[string]string{k: raw["value"]}
	}

	for k, v := range raw {
		if k == "currency" {
			if v != "KRW" && v != "JPY" {
				httpError(w, http.StatusBadRequest, "통화는 KRW 또는 JPY만 가능합니다.")
				return
			}
			existing, _ := getSetting("currency")
			if existing != "" {
				if existing != v {
					httpError(w, http.StatusConflict, "통화는 최초 설정 후 변경할 수 없습니다.")
					return
				}
				continue // already set to the same value — no-op
			}
		}
		if _, err := db.Exec(
			`INSERT INTO settings (key, value) VALUES (?, ?)
			 ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
			k, v,
		); err != nil {
			httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---------------------------------------------------------------------------
// Exchange rate (proxied from ExchangeRate-API's free, key-less endpoint)
// ---------------------------------------------------------------------------

type rateCacheEntry struct {
	rates     map[string]float64
	fetchedAt time.Time
}

var (
	rateCache   = map[string]rateCacheEntry{}
	rateCacheMu sync.Mutex
	httpClient  = &http.Client{Timeout: 10 * time.Second}
)

func fetchRates(base string) (map[string]float64, error) {
	rateCacheMu.Lock()
	if e, ok := rateCache[base]; ok && time.Since(e.fetchedAt) < time.Hour {
		rateCacheMu.Unlock()
		return e.rates, nil
	}
	rateCacheMu.Unlock()

	resp, err := httpClient.Get("https://open.er-api.com/v6/latest/" + base)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("upstream status %d", resp.StatusCode)
	}

	var body struct {
		Result string             `json:"result"`
		Rates  map[string]float64 `json:"rates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, err
	}
	if body.Result != "success" || body.Rates == nil {
		return nil, fmt.Errorf("upstream error")
	}

	rateCacheMu.Lock()
	rateCache[base] = rateCacheEntry{rates: body.Rates, fetchedAt: time.Now()}
	rateCacheMu.Unlock()
	return body.Rates, nil
}

func exchangeRate(w http.ResponseWriter, r *http.Request) {
	from := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("from")))
	if from == "" {
		httpError(w, http.StatusBadRequest, "기준 통화를 지정하세요.")
		return
	}
	to, _ := getSetting("currency")
	if to == "" {
		httpError(w, http.StatusBadRequest, "기본 통화가 설정되지 않았습니다.")
		return
	}

	var amount float64
	if a := r.URL.Query().Get("amount"); a != "" {
		_, _ = fmt.Sscanf(a, "%f", &amount)
	}

	rates, err := fetchRates(from)
	if err != nil {
		httpError(w, http.StatusBadGateway, "환율 정보를 가져오지 못했습니다.")
		return
	}
	rate, ok := rates[to]
	if !ok {
		httpError(w, http.StatusBadRequest, "지원하지 않는 통화입니다.")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"from":      from,
		"to":        to,
		"rate":      rate,
		"amount":    amount,
		"converted": amount * rate,
	})
}

// ---------------------------------------------------------------------------
// Page handlers & server
// ---------------------------------------------------------------------------

func renderPage(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tmpl.ExecuteTemplate(w, name, nil); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}
}

func main() {
	if err := initDB(); err != nil {
		log.Fatalf("DB 초기화 실패: %v", err)
	}
	defer db.Close()

	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", renderPage("index.html"))
	r.Get("/dashboard", renderPage("dashboard.html"))

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("정적 파일 로드 실패: %v", err)
	}
	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.FS(staticSub))))

	r.Route("/api", func(r chi.Router) {
		r.Post("/expenses", createExpense)
		r.Get("/expenses", listExpenses)
		r.Put("/expenses/{id}", updateExpense)
		r.Delete("/expenses/{id}", deleteExpense)
		r.Get("/dashboard", dashboardSummary)
		r.Get("/settings", getSettings)
		r.Post("/settings", saveSettings)
		r.Get("/exchange-rate", exchangeRate)
	})

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	addr := ":" + port
	log.Printf("gemsil 서버 시작: http://localhost%s", addr)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatal(err)
	}
}
