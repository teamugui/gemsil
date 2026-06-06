// Package handler holds gemsil's HTTP handlers. A Handler bundles the
// dependencies the handlers need — the data store, the page templates, and the
// exchange-rate cache — so nothing relies on package-global state.
package handler

import (
	"encoding/json"
	"html/template"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"gemsil/internal/store"
)

// Handler serves gemsil's HTTP API and pages.
type Handler struct {
	store *store.Store
	tmpl  *template.Template

	// Exchange-rate proxy state.
	httpClient  *http.Client
	rateCacheMu sync.Mutex
	rateCache   map[string]rateCacheEntry
}

// New builds a Handler backed by s and rendering pages from tmpl.
func New(s *store.Store, tmpl *template.Template) *Handler {
	return &Handler{
		store:      s,
		tmpl:       tmpl,
		httpClient: &http.Client{Timeout: 10 * time.Second},
		rateCache:  map[string]rateCacheEntry{},
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func httpError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func expenseIDFromRequest(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	return id, err == nil && id > 0
}
