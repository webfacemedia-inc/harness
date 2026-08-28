package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

// version is set from the release tag at build time (-ldflags "-X main.version=0.1.4").
var version = "dev"

func main() {
	app := NewApp()

	appMenu := menu.NewMenu()
	if goos == "darwin" {
		appMenu.Append(menu.AppMenu())
	}
	desk := appMenu.AddSubmenu("Desk")
	// A keyboard path back to the address screen: focus inside the Desk iframe never reaches the overlay button.
	desk.AddText("Change Desk…", keys.Combo("d", keys.CmdOrCtrlKey, keys.ShiftKey), func(_ *menu.CallbackData) {
		runtime.EventsEmit(app.ctx, "desk:change")
	})
	appMenu.Append(menu.EditMenu())

	err := wails.Run(&options.App{
		Title:  "webfaCe Desk",
		Width:  1280,
		Height: 860,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// Matches the address screen's light ground; no dark flash on launch.
		BackgroundColour: &options.RGBA{R: 245, G: 248, B: 251, A: 1},
		Menu:             appMenu,
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
