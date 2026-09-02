package main

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound application: a window onto a Desk.
type App struct {
	ctx             context.Context
	changeRequested bool
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
		cleanupAfterUpdate()
		if translocated := clearQuarantine(); translocated {
			runtime.EventsEmit(ctx, "desk:translocated")
		}
	}()
}

// RequestChange is called from the Desk menu: the next load of the app page shows the address screen instead of opening the saved Desk.
func (a *App) RequestChange() {
	a.changeRequested = true
	runtime.WindowReloadApp(a.ctx)
}

// ChangeRequested reports (and clears) a pending Change Desk request.
func (a *App) ChangeRequested() bool {
	v := a.changeRequested
	a.changeRequested = false
	return v
}

// Version reports the build's release version ("dev" for local builds).
func (a *App) Version() string {
	return version
}
