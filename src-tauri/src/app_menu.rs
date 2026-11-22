//! Application menu. On macOS this is the menu bar; on Windows and Linux it is shown in the window.
//! Clicks are forwarded to the frontend as a "menu-action" event carrying the item id.

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

fn item<R: Runtime>(app: &AppHandle<R>, id: &str, label: &str, accelerator: Option<&str>) -> tauri::Result<MenuItem<R>> {
    let mut builder = MenuItemBuilder::with_id(id, label);
    if let Some(accel) = accelerator {
        builder = builder.accelerator(accel);
    }
    builder.build(app)
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let settings = item(app, "settings", "Settings…", Some("CmdOrCtrl+,"))?;
    let mut app_menu = SubmenuBuilder::new(app, "GoBirdie Desktop")
        .about(None)
        .separator()
        .item(&settings)
        .separator();
    #[cfg(target_os = "macos")]
    {
        app_menu = app_menu.hide().hide_others().separator();
    }
    let app_menu = app_menu.quit().build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&item(app, "file-export", "Export Rounds to File…", None)?)
        .item(&item(app, "file-import", "Import Rounds from File…", None)?)
        .separator()
        .item(&item(app, "gdrive", "Google Drive Backup…", None)?)
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&item(app, "trends", "Trends", None)?)
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help").build()?;

    let menu = MenuBuilder::new(app)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let _ = app.emit("menu-action", event.id().0.clone());
    });
    Ok(())
}
