//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// clearQuarantine removes macOS's quarantine attribute from this app bundle
// so the next launch does not show the "cannot be opened" warning. The first
// launch still needs right-click → Open (Gatekeeper runs before we do); after
// that the app runs like any other. Best-effort and silent.
func clearQuarantine() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	// …/webfaCe Desk.app/Contents/MacOS/webfaCe Desk → the .app directory
	bundle := exe
	for i := 0; i < 4; i++ {
		bundle = filepath.Dir(bundle)
		if strings.HasSuffix(bundle, ".app") {
			_ = exec.Command("/usr/bin/xattr", "-dr", "com.apple.quarantine", bundle).Run()
			return
		}
	}
}
