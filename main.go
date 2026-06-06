// gemsil — a manual-entry personal budget tracker.
//
// Single self-contained binary: HTML templates and static assets are embedded
// via go:embed (see embed.go), and the SQLite database file is created next to
// the binary. main wires the layers — store (data), handler (HTTP), server
// (routing) — and starts the server.
package main

import (
	"html/template"
	"io/fs"
	"log"
	"net/http"
	"os"

	"gemsil/internal/handler"
	"gemsil/internal/server"
	"gemsil/internal/store"
)

func main() {
	s, err := store.Open("gemsil.db")
	if err != nil {
		log.Fatalf("DB 초기화 실패: %v", err)
	}
	defer s.Close()

	tmpl := template.Must(template.ParseFS(templatesFS, "templates/*.html"))

	staticSub, err := fs.Sub(staticFS, "static")
	if err != nil {
		log.Fatalf("정적 파일 로드 실패: %v", err)
	}

	h := handler.New(s, tmpl)
	r := server.New(h, staticSub)

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
