//go:build darwin

package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The update pipeline against the real release: feed, download, ditto unpack,
// codesign verify, team pin. Network + notarised zip, so it runs only when
// asked: DESK_UPDATE_LIVE_TEST=1 go test ./...
func TestUpdatePipelineAgainstLatestRelease(t *testing.T) {
	if os.Getenv("DESK_UPDATE_LIVE_TEST") == "" {
		t.Skip("set DESK_UPDATE_LIVE_TEST=1 to run the live release check")
	}
	ver, url, err := latestRelease()
	if err != nil {
		t.Fatalf("latestRelease: %v", err)
	}
	if ver == "" || strings.HasPrefix(ver, "desktop-") {
		t.Fatalf("version not cleaned from tag: %q", ver)
	}
	work := t.TempDir()
	zipPath := filepath.Join(work, updateAsset)
	if err := download(url, zipPath); err != nil {
		t.Fatalf("download: %v", err)
	}
	app, err := extractAndVerify(zipPath, work)
	if err != nil {
		t.Fatalf("extractAndVerify rejected the genuine release: %v", err)
	}
	if !strings.HasSuffix(app, ".app") {
		t.Fatalf("expected an .app path, got %s", app)
	}
}

// A bundle NOT signed by our team must be refused, even when its signature is
// intact — the pin is the whole safety story. Safari is signed by Apple.
func TestVerifyRefusesForeignSignature(t *testing.T) {
	if _, err := os.Stat("/Applications/Safari.app"); err != nil {
		t.Skip("no /Applications/Safari.app on this machine")
	}
	work := t.TempDir()
	zipPath := filepath.Join(work, updateAsset)
	if out, err := exec.Command("/usr/bin/ditto", "-c", "-k", "--keepParent", "/Applications/Safari.app", zipPath).CombinedOutput(); err != nil {
		t.Skipf("could not zip Safari: %v: %s", err, out)
	}
	if _, err := extractAndVerify(zipPath, work); err == nil {
		t.Fatal("a foreign-signed bundle was accepted — the team pin is not working")
	}
}

// A tampered bundle must be refused: valid team, broken seal.
func TestVerifyRefusesTamperedBundle(t *testing.T) {
	if os.Getenv("DESK_UPDATE_LIVE_TEST") == "" {
		t.Skip("set DESK_UPDATE_LIVE_TEST=1 to run the live release check")
	}
	_, url, err := latestRelease()
	if err != nil {
		t.Fatalf("latestRelease: %v", err)
	}
	work := t.TempDir()
	zipPath := filepath.Join(work, updateAsset)
	if err := download(url, zipPath); err != nil {
		t.Fatalf("download: %v", err)
	}
	unpack := filepath.Join(work, "tamper")
	if out, err := exec.Command("/usr/bin/ditto", "-x", "-k", zipPath, unpack).CombinedOutput(); err != nil {
		t.Fatalf("ditto: %v: %s", err, out)
	}
	entries, _ := os.ReadDir(unpack)
	var app string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			app = filepath.Join(unpack, e.Name())
		}
	}
	if app == "" {
		t.Fatal("no .app unpacked")
	}
	// Poison one resource, then re-zip and run the real verification path.
	if err := os.WriteFile(filepath.Join(app, "Contents", "Resources", "tampered.txt"), []byte("x"), 0o644); err != nil {
		t.Fatalf("tamper write: %v", err)
	}
	rezip := filepath.Join(work, "rezip-"+updateAsset)
	if out, err := exec.Command("/usr/bin/ditto", "-c", "-k", "--keepParent", app, rezip).CombinedOutput(); err != nil {
		t.Fatalf("rezip: %v: %s", err, out)
	}
	work2 := t.TempDir()
	if _, err := extractAndVerify(rezip, work2); err == nil {
		t.Fatal("a tampered bundle was accepted")
	}
}
