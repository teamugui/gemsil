Build a personal budget tracking web app called "gemsil" with the following specifications:

## Tech Stack
- Backend: Go (net/http standard library + chi router)
- Database: SQLite (modernc.org/sqlite, no CGO)
- Frontend: HTML + Vanilla JS + Tailwind CSS (CDN)
- Deployment: Single binary via `go build`

## Project Structure
gemsil/
├── main.go
├── go.mod
├── static/
│   └── js/
│       └── app.js
└── templates/
├── index.html
└── dashboard.html

## Core Concept
This app is intentionally manual-entry only. No bank/card auto-sync.
The act of manually recording each expense is itself a feature — it helps the user reflect on spending habits.

## Currency
- Single currency per user, selected once at first launch (KRW or JPY)
- Currency cannot be changed after setup
- Exchange rate calculator is available only on the input form
- Exchange rate fetched from ExchangeRate-API (free tier, no API key for basic use) — display converted amount so user can enter it in their base currency

## Screens

### 1. Index (Input Form)
Fields:
- Amount (number)
- Merchant (text)
- Description (text)
- Payment type: one of [일반(one-time) / 월 정기(monthly recurring) / 연 정기(annual recurring)]
- Date: auto-filled with today's date (not editable)

Exchange rate calculator (collapsible or inline):
- Input foreign amount + select currency
- Show converted amount in user's base currency
- User manually copies the converted value into the Amount field

### 2. Dashboard
Display:
- This month's fixed expenses (sum of monthly recurring + annual recurring prorated monthly)
- This month's variable expenses (one-time payments)
- This month's total
- Full expense list with filter options (e.g. filter by payment type)

Recurring payment behavior:
- Monthly recurring entries are automatically added to the current month's expense list on their original entry date each month
- Annual recurring entries are prorated (annual amount / 12) and shown in the monthly fixed expense total

## Database Schema (SQLite)
Table: expenses
- id INTEGER PRIMARY KEY
- amount REAL
- merchant TEXT
- description TEXT
- payment_type TEXT -- 'once', 'monthly', 'annual'
- date TEXT -- ISO 8601, auto-set to today
- created_at TEXT

Table: settings
- key TEXT PRIMARY KEY
- value TEXT
  -- e.g. key='currency', value='KRW'

## API Endpoints
- GET  /                    → serve index.html
- GET  /dashboard           → serve dashboard.html
- POST /api/expenses        → create expense
- GET  /api/expenses        → list expenses (support ?type=monthly filter)
- GET  /api/dashboard       → return monthly summary (fixed/variable/total)
- GET  /api/settings        → get user settings
- POST /api/settings        → save user settings
- GET  /api/exchange-rate   → fetch and return exchange rate from ExchangeRate-API

## Additional Requirements
- On first launch, if no currency setting exists, show a currency selection screen before anything else
- The binary should serve everything self-contained (templates embedded via Go's embed package)
- SQLite database file created in the same directory as the binary
- No Docker, no external runtime dependencies