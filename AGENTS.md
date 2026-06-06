# Repository Guidelines

## Project Structure & Module Organization

This repository is a compact Go web app for manual budget tracking. The backend lives in `main.go` as a single `main` package, with Chi routes, SQLite access, embedded assets, and page handlers. HTML views are in `templates/` (`index.html`, `dashboard.html`) and shared browser logic is in `static/js/app.js`. Reference material belongs in `docs/`. The local SQLite file `gemsil.db` and built binary `gemsil` may appear in the root; treat them as runtime artifacts unless a change explicitly requires updating data or release binaries.

## Build, Test, and Development Commands

- `go run .` starts the app locally on `http://localhost:8080` and creates/uses `gemsil.db`.
- `PORT=9090 go run .` runs the same server on another port.
- `go build -o gemsil .` builds a self-contained binary with embedded templates and static assets.
- `go test ./...` runs all Go package tests; currently this reports no test files.
- `gofmt -w main.go` formats Go code before committing.

## Coding Style & Naming Conventions

Use standard Go formatting and keep backend changes idiomatic: tabs from `gofmt`, exported types in PascalCase, unexported functions and variables in camelCase. Keep HTTP handlers small and return JSON errors through the existing `httpError` helper. Preserve the current Korean user-facing messages unless the task is to revise copy. Frontend code in `static/js/app.js` uses plain JavaScript, camelCase function names, and small DOM helper functions.

## Testing Guidelines

Add Go tests next to implementation files using the `*_test.go` suffix. Prefer focused tests for pure helpers such as month validation, dashboard calculations, and settings behavior. For handler tests, use `net/http/httptest` and isolate SQLite state with a temporary database path or setup/teardown logic. Run `go test ./...` before handing off changes.

## Commit & Pull Request Guidelines

Git history was not available in this workspace, so use a simple imperative commit style such as `Add dashboard month selector` or `Fix currency validation`. Pull requests should describe the user-visible change, list verification commands, mention database/schema impact, and include screenshots for template or frontend changes.

## Security & Configuration Tips

The app stores data in `gemsil.db` in the working directory, so avoid committing personal expense data. External exchange-rate calls go through `https://open.er-api.com`; tests should not depend on live network access. Use the `PORT` environment variable for local port changes.
