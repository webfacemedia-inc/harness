package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound application: a window onto a Desk.
type App struct {
	ctx context.Context
}

// NewApp creates the application struct.
func NewApp() *App {
	return &App{}
}

// startup keeps the context for runtime calls and clears the macOS quarantine
// flag; when the app runs from a translocated copy (opened from Downloads) the
// frontend is told so it can ask the user to move it to Applications.
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	go func() {
		if translocated := clearQuarantine(); translocated {
			runtime.EventsEmit(ctx, "desk:translocated")
		}
	}()
}

// Version reports the build's release version ("dev" for local builds).
func (a *App) Version() string {
	return version
}
