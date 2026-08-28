//go:build !darwin

package main

const goos = "other"

// clearQuarantine is macOS-only; other platforms have nothing to clear.
func clearQuarantine() (translocated bool) { return false }
