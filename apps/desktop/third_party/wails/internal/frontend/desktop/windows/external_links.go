//go:build windows

package windows

import (
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/webview2"
)

// External links (webfaCe Desk patch): a target=_blank click raises
// NewWindowRequested; left unhandled, WebView2 answers it with a bare unbranded
// popup — or nothing at all. The Desk is one window on purpose, so anything that
// wants a new window belongs in the user's own browser, where their sessions
// and passwords already live.
//
// The edge package wires no NewWindowRequested callback, so this registers the
// COM handler directly. edge.ICoreWebView2 and webview2.ICoreWebView2 both wrap
// the same COM interface pointer (a struct holding only the vtbl pointer), so
// the cast below swaps wrappers around one object, nothing more.

type newWindowRequested struct {
	frontend *Frontend
}

func (h *newWindowRequested) QueryInterface(_, _ uintptr) uintptr { return 0 }
func (h *newWindowRequested) AddRef() uintptr                     { return 1 }
func (h *newWindowRequested) Release() uintptr                    { return 1 }
func (h *newWindowRequested) NewWindowRequested(_ *webview2.ICoreWebView2, args *webview2.ICoreWebView2NewWindowRequestedEventArgs) uintptr {
	// Handled either way: the one thing that must never happen is the bare popup.
	_ = args.PutHandled(true)
	if uri, err := args.GetUri(); err == nil && uri != "" {
		h.frontend.BrowserOpenURL(uri)
	}
	return 0
}

// Kept at package scope so the garbage collector never frees a handler COM still holds.
var newWindowHandler *webview2.ICoreWebView2NewWindowRequestedEventHandler

// openExternalLinksInBrowser sends every new-window request to the system
// browser. Call once, after chromium.Embed has produced the controller; the
// registration lives for the life of the webview, so the token is not kept.
func (f *Frontend) openExternalLinksInBrowser() {
	controller := f.chromium.GetController()
	if controller == nil {
		return
	}
	core, err := controller.GetCoreWebView2()
	if err != nil || core == nil {
		return
	}
	view := (*webview2.ICoreWebView2)(unsafe.Pointer(core))
	newWindowHandler = webview2.NewICoreWebView2NewWindowRequestedEventHandler(&newWindowRequested{frontend: f})
	if _, err := view.AddNewWindowRequested(newWindowHandler); err != nil {
		f.logger.Warning("external links: AddNewWindowRequested failed: %s", err)
	}
}
