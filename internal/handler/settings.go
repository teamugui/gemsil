package handler

import (
	"encoding/json"
	"net/http"
)

func (h *Handler) GetSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := h.store.ListSettings()
	if err != nil {
		httpError(w, http.StatusInternalServerError, "조회에 실패했습니다.")
		return
	}
	writeJSON(w, http.StatusOK, settings)
}

// SaveSettings accepts either a {"key":..,"value":..} pair or a flat object of
// settings. The currency is immutable: once set, attempting to change it returns
// 409 Conflict.
func (h *Handler) SaveSettings(w http.ResponseWriter, r *http.Request) {
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
			existing, _ := h.store.GetSetting("currency")
			if existing != "" {
				if existing != v {
					httpError(w, http.StatusConflict, "통화는 최초 설정 후 변경할 수 없습니다.")
					return
				}
				continue // already set to the same value — no-op
			}
		}
		if err := h.store.SaveSetting(k, v); err != nil {
			httpError(w, http.StatusInternalServerError, "저장에 실패했습니다.")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
