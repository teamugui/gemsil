package handler

import "net/http"

// RenderPage returns a handler that renders the named template with no data.
func (h *Handler) RenderPage(name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := h.tmpl.ExecuteTemplate(w, name, nil); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	}
}
