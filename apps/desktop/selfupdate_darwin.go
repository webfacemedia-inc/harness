//go:build darwin

package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Self-update: download the latest notarised release zip, verify it carries our
// Developer ID signature, swap this bundle for it and relaunch. The signature
// pin is what makes this safe — files an app downloads itself never pass
// through Gatekeeper, so nothing gets installed unless codesign says it is
// intact AND signed by our team.
const (
	updateTeamID = "2SKCVAFWZ6" // Developer ID Application: webfaCeMEdia Inc
	updateRepo   = "webfacemedia-inc/harness"
	updateAsset  = "webfaCe-Desk-macOS.zip"
)

// Update runs the whole flow and reports how it ended:
//
//	"restarting" — installed, the new build is taking over
//	"current"    — this build is already the latest
//	"manual"     — self-update cannot work here (dev build, translocated, or
//	               the bundle's folder is not writable); use the download page
//
// anything else is an error message for the owner. Progress is emitted on the
// "desk:update" event so the address screen can narrate.
func (a *App) Update() string {
	stage := func(s string) { runtime.EventsEmit(a.ctx, "desk:update", s) }

	bundle, ok := updatableBundle()
	if !ok {
		return "manual"
	}

	stage("checking")
	latest, zipURL, err := latestRelease()
	if err != nil {
		return "could not reach the release feed — check your connection"
	}
	if latest == version {
		return "current"
	}

	stage("downloading")
	work, err := os.MkdirTemp(filepath.Dir(bundle), ".webfaCe Desk.update-")
	if err != nil {
		return "manual"
	}
	defer os.RemoveAll(work)
	zipPath := filepath.Join(work, updateAsset)
	if err := download(zipURL, zipPath); err != nil {
		return "the download failed — check your connection"
	}

	stage("verifying")
	newApp, err := extractAndVerify(zipPath, work)
	if err != nil {
		return "the downloaded app failed its signature check — nothing was installed"
	}

	stage("installing")
	aside := filepath.Join(filepath.Dir(bundle), fmt.Sprintf(".webfaCe Desk.old-%d", os.Getpid()))
	if err := os.Rename(bundle, aside); err != nil {
		return "could not replace the app — it may need an update by hand this once"
	}
	if err := os.Rename(newApp, bundle); err != nil {
		_ = os.Rename(aside, bundle) // put the working copy back
		return "could not install the new app — nothing was changed"
	}

	stage("restarting")
	// The old bundle (this running copy's home) is cleaned up by the NEW
	// instance on startup; relaunch after this process has let go.
	cmd := exec.Command("/bin/sh", "-c", fmt.Sprintf("sleep 1; /usr/bin/open %q", bundle))
	if err := cmd.Start(); err == nil {
		go func() { time.Sleep(300 * time.Millisecond); runtime.Quit(a.ctx) }()
	}
	return "restarting"
}

// updatableBundle finds the .app this process runs from, if it is somewhere a
// swap can happen: not a dev build, not a translocated read-only copy, and in
// a folder this user can write.
func updatableBundle() (string, bool) {
	if version == "dev" {
		return "", false
	}
	exe, err := os.Executable()
	if err != nil || strings.Contains(exe, "/AppTranslocation/") {
		return "", false
	}
	bundle := exe
	for i := 0; i < 4 && !strings.HasSuffix(bundle, ".app"); i++ {
		bundle = filepath.Dir(bundle)
	}
	if !strings.HasSuffix(bundle, ".app") {
		return "", false
	}
	probe, err := os.CreateTemp(filepath.Dir(bundle), ".webfaCe Desk.probe-")
	if err != nil {
		return "", false
	}
	probe.Close()
	os.Remove(probe.Name())
	return bundle, true
}

// latestRelease reads the newest desktop-v* release and returns its version
// and the macOS zip's download URL.
func latestRelease() (string, string, error) {
	client := &http.Client{Timeout: 20 * time.Second}
	resp, err := client.Get("https://api.github.com/repos/" + updateRepo + "/releases/latest")
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", "", fmt.Errorf("release feed answered %d", resp.StatusCode)
	}
	var rel struct {
		TagName string `json:"tag_name"`
		Assets  []struct {
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rel); err != nil {
		return "", "", err
	}
	for _, asset := range rel.Assets {
		if asset.Name == updateAsset {
			return strings.TrimPrefix(rel.TagName, "desktop-v"), asset.URL, nil
		}
	}
	return "", "", fmt.Errorf("release %s has no %s", rel.TagName, updateAsset)
}

func download(url, dest string) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("download answered %d", resp.StatusCode)
	}
	f, err := os.Create(dest)
	if err != nil {
		return err
	}
	defer f.Close()
	if _, err := f.ReadFrom(resp.Body); err != nil {
		os.Remove(dest)
		return err
	}
	return f.Close()
}

// extractAndVerify unpacks the zip (ditto keeps the notarisation ticket's
// extended attributes intact) and accepts the bundle only if codesign finds it
// unbroken and signed by our team.
func extractAndVerify(zipPath, work string) (string, error) {
	unpack := filepath.Join(work, "unpacked")
	if out, err := exec.Command("/usr/bin/ditto", "-x", "-k", zipPath, unpack).CombinedOutput(); err != nil {
		return "", fmt.Errorf("ditto: %v: %s", err, out)
	}
	entries, err := os.ReadDir(unpack)
	if err != nil {
		return "", err
	}
	var newApp string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".app") {
			newApp = filepath.Join(unpack, e.Name())
			break
		}
	}
	if newApp == "" {
		return "", fmt.Errorf("no .app in %s", updateAsset)
	}
	if out, err := exec.Command("/usr/bin/codesign", "--verify", "--deep", "--strict", newApp).CombinedOutput(); err != nil {
		return "", fmt.Errorf("codesign verify: %v: %s", err, out)
	}
	info, err := exec.Command("/usr/bin/codesign", "--display", "--verbose=2", newApp).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("codesign display: %v", err)
	}
	if !strings.Contains(string(info), "TeamIdentifier="+updateTeamID) {
		return "", fmt.Errorf("bundle is signed by someone else")
	}
	return newApp, nil
}

// cleanupAfterUpdate removes what a previous self-update left behind: the old
// bundle set aside during the swap, and any unpack folder an interrupted run
// abandoned. Best-effort, run once at startup.
func cleanupAfterUpdate() {
	exe, err := os.Executable()
	if err != nil {
		return
	}
	bundle := exe
	for i := 0; i < 4 && !strings.HasSuffix(bundle, ".app"); i++ {
		bundle = filepath.Dir(bundle)
	}
	if !strings.HasSuffix(bundle, ".app") {
		return
	}
	entries, err := os.ReadDir(filepath.Dir(bundle))
	if err != nil {
		return
	}
	for _, e := range entries {
		name := e.Name()
		if strings.HasPrefix(name, ".webfaCe Desk.old-") || strings.HasPrefix(name, ".webfaCe Desk.update-") {
			_ = os.RemoveAll(filepath.Join(filepath.Dir(bundle), name))
		}
	}
}
