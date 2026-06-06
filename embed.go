package main

import "embed"

// Embedded assets. The directives live at the module root so the patterns can
// reach templates/ and static/ without crossing a parent boundary.

//go:embed templates/*.html
var templatesFS embed.FS

//go:embed static
var staticFS embed.FS
