use tauri_plugin_sql::{Migration, MigrationKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "ascents, routes, settings",
        sql: "CREATE TABLE ascents (id TEXT PRIMARY KEY, peak_id TEXT NOT NULL, date TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', route_id TEXT);
              CREATE INDEX ascents_peak ON ascents(peak_id);
              CREATE TABLE routes (id TEXT PRIMARY KEY, data TEXT NOT NULL);
              CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }, Migration {
        version: 2,
        description: "user campsites",
        sql: "CREATE TABLE campsites (id TEXT PRIMARY KEY, data TEXT NOT NULL);",
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:adk.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
