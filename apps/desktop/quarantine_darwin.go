//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const goos = "darwin"

// clearQuarantine removes macOS's quarantine attribute from this app bundle so
// the next launch does not show the "cannot be opened" warning. The first
// launch still needs right-click → Open (Gatekeeper runs before we do). When
// macOS runs the app from a translocated read-only copy (it was opened from
// Downloads rather than Applications) the original keeps its flag; the caller
// is told so the user can be asked to move the app. Best-effort and silent.
func clearQuarantine() (translocated bool) {
	exe, err := os.Executable()
	if err != nil {
		return false
	}
	if strings.Contains(exe, "/AppTranslocation/") {
		return true
	}
	bundle := exe
	for i := 0; i < 4; i++ {
		bundle = filepath.Dir(bundle)
		if strings.HasSuffix(bundle, ".app") {
			_ = exec.Command("/usr/bin/xattr", "-dr", "com.apple.quarantine", bundle).Run()
			return false
		}
	}
	return false
}
