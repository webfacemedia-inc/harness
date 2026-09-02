//go:build !darwin

package main

// Self-update is built for macOS first (signature-pinned swap-and-relaunch);
// Windows and Linux fall back to the download page.
func (a *App) Update() string { return "manual" }

func cleanupAfterUpdate() {}
