// Package server wires gemsil's HTTP routes and middleware onto a chi router.
package server

import (
	"io/fs"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"gemsil/internal/handler"
)

// New builds the application's HTTP handler. staticFS is served under /static/.
func New(h *handler.Handler, staticFS fs.FS) http.Handler {
	r := chi.NewRouter()
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)

	r.Get("/", h.RenderPage("index.html"))
	r.Get("/dashboard", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/", http.StatusMovedPermanently)
	})

	r.Handle("/static/*", http.StripPrefix("/static/", http.FileServer(http.FS(staticFS))))

	r.Route("/api", func(r chi.Router) {
		r.Post("/expenses", h.CreateExpense)
		r.Get("/expenses", h.ListExpenses)
		r.Put("/expenses/{id}", h.UpdateExpense)
		r.Delete("/expenses/{id}", h.DeleteExpense)
		r.Get("/merchants", h.SuggestMerchants)
		r.Get("/expense-goals", h.GetExpenseGoal)
		r.Post("/expense-goals", h.CreateExpenseGoal)
		r.Get("/expense-goals/history", h.ListExpenseGoalHistory)
		r.Get("/actual-expenses", h.GetActualExpense)
		r.Post("/actual-expenses", h.CreateActualExpense)
		r.Get("/actual-expenses/history", h.ListActualExpenseHistory)
		r.Get("/dashboard", h.Dashboard)
		r.Get("/settings", h.GetSettings)
		r.Post("/settings", h.SaveSettings)
		r.Get("/exchange-rate", h.ExchangeRate)
	})

	return r
}
