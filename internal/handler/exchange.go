package handler

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// rateCacheEntry is one base currency's cached rate table.
type rateCacheEntry struct {
	rates     map[string]float64
	fetchedAt time.Time
}

// fetchRates returns the rate table for base, proxied from ExchangeRate-API's
// free, key-less endpoint and cached per base for one hour.
func (h *Handler) fetchRates(base string) (map[string]float64, error) {
	h.rateCacheMu.Lock()
	if e, ok := h.rateCache[base]; ok && time.Since(e.fetchedAt) < time.Hour {
		h.rateCacheMu.Unlock()
		return e.rates, nil
	}
	h.rateCacheMu.Unlock()

	resp, err := h.httpClient.Get("https://open.er-api.com/v6/latest/" + base)
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

	h.rateCacheMu.Lock()
	h.rateCache[base] = rateCacheEntry{rates: body.Rates, fetchedAt: time.Now()}
	h.rateCacheMu.Unlock()
	return body.Rates, nil
}

func (h *Handler) ExchangeRate(w http.ResponseWriter, r *http.Request) {
	from := strings.ToUpper(strings.TrimSpace(r.URL.Query().Get("from")))
	if from == "" {
		httpError(w, http.StatusBadRequest, "기준 통화를 지정하세요.")
		return
	}
	to, _ := h.store.GetSetting("currency")
	if to == "" {
		httpError(w, http.StatusBadRequest, "기본 통화가 설정되지 않았습니다.")
		return
	}

	var amount float64
	if a := r.URL.Query().Get("amount"); a != "" {
		_, _ = fmt.Sscanf(a, "%f", &amount)
	}

	rates, err := h.fetchRates(from)
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
