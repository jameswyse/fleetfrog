//! What T3 Code has on this machine: its projects and their threads from its database, the images
//! its projects show as icons, its running server and the coding agents it has checked.

use std::collections::HashMap;

use base64::Engine;
use rusqlite::types::Value;
use serde::Deserialize;

use crate::paths;
use crate::process::run_tool;
use crate::protocol::{
    Count, ProjectIcon, ProjectIconFile, T3CodeProject, T3CodeProvider, T3CodeReading,
    T3CodeSchema, T3CodeServer, T3CodeStatus, T3CodeThread, T3CodeThreadState,
};
use crate::time::Utc;

const V2_DATABASE: &str = "statev2.sqlite";

/// Where T3 Code keeps its database, following its `T3CODE_HOME` setting.
pub fn database_path() -> String {
    let userdata = paths::join(
        &paths::env("T3CODE_HOME").unwrap_or_else(|| paths::join(&paths::home(), ".t3")),
        "userdata",
    );
    let v2 = paths::join(&userdata, V2_DATABASE);

    if std::fs::metadata(&v2).is_ok() {
        v2
    } else {
        paths::join(&userdata, "state.sqlite")
    }
}

type Columns = &'static [(&'static str, &'static [&'static str])];

/// Every column read below, checked first so a changed schema is named rather than misread.
const REQUIRED_COLUMNS: Columns = &[
    ("effect_sql_migrations", &["migration_id", "name"]),
    (
        "projection_projects",
        &[
            "project_id",
            "title",
            "workspace_root",
            "project_icon_json",
            "favicon_path",
            "auto_pull",
            "updated_at",
            "deleted_at",
        ],
    ),
];

struct Layout {
    columns: Columns,
    threads: &'static str,
    worktree_in_payload: bool,
}

const V1_LAYOUT: Layout = Layout {
    columns: &[
        (
            "projection_threads",
            &[
                "thread_id",
                "project_id",
                "title",
                "worktree_path",
                "archived_at",
                "deleted_at",
                "updated_at",
                "pending_approval_count",
                "pending_user_input_count",
            ],
        ),
        (
            "projection_thread_sessions",
            &["thread_id", "status", "active_turn_id"],
        ),
    ],
    threads: "select thread.thread_id, thread.project_id, thread.title, thread.worktree_path,
          thread.archived_at is not null as archived, thread.updated_at,
          thread.pending_approval_count > 0 or thread.pending_user_input_count > 0 as waiting,
          session.active_turn_id is not null
            or ifnull(session.status, '') in ('starting', 'running') as working
        from projection_threads as thread
        left join projection_thread_sessions as session on session.thread_id = thread.thread_id
        where thread.deleted_at is null",
    worktree_in_payload: false,
};

const V2_LAYOUT: Layout = Layout {
    columns: &[
        (
            "orchestration_v2_projection_threads",
            &[
                "thread_id",
                "project_id",
                "title",
                "payload_json",
                "archived_at",
                "deleted_at",
                "updated_at",
            ],
        ),
        (
            "orchestration_v2_projection_runtime_requests",
            &["thread_id", "kind", "status"],
        ),
        ("orchestration_v2_projection_runs", &["thread_id", "status"]),
    ],
    threads: "select thread.thread_id, thread.project_id, thread.title, thread.payload_json,
          thread.archived_at is not null as archived, thread.updated_at,
          exists (
            select 1 from orchestration_v2_projection_runtime_requests as request
            where request.thread_id = thread.thread_id and request.status = 'pending'
              and request.kind <> 'auth_refresh'
          ) as waiting,
          exists (
            select 1 from orchestration_v2_projection_runs as run
            where run.thread_id = thread.thread_id
              and run.status in ('preparing', 'starting', 'running', 'waiting')
          ) as working
        from orchestration_v2_projection_threads as thread
        where thread.deleted_at is null",
    worktree_in_payload: true,
};

/// The colours T3 Code offers for project icons.
const COLOURS: [&str; 18] = [
    "gray", "red", "orange", "amber", "yellow", "lime", "green", "emerald", "teal", "cyan", "sky",
    "blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose",
];

struct ProjectRow {
    project_id: String,
    title: String,
    workspace_root: String,
    project_icon_json: Option<String>,
    favicon_path: Option<String>,
    auto_pull: i64,
    updated_at: Utc,
}

struct ThreadRow {
    thread_id: String,
    project_id: String,
    title: String,
    worktree_path: Option<String>,
    archived: i64,
    updated_at: Utc,
    waiting: i64,
    working: i64,
}

/// A row's columns as the TypeScript agent's schemas read them: a row with a value of the wrong
/// type is left out and counted, rather than failing the whole read.
struct Row(Vec<Value>);

impl Row {
    fn text(&self, index: usize) -> Option<String> {
        match self.0.get(index)? {
            Value::Text(text) => Some(text.clone()),
            _ => None,
        }
    }

    fn nullable_text(&self, index: usize) -> Option<Option<String>> {
        match self.0.get(index)? {
            Value::Null => Some(None),
            Value::Text(text) => Some(Some(text.clone())),
            _ => None,
        }
    }

    fn integer(&self, index: usize) -> Option<i64> {
        match self.0.get(index)? {
            Value::Integer(number) => Some(*number),
            Value::Real(number)
                if number.fract() == 0.0 && number.abs() < 9_007_199_254_740_992.0 =>
            {
                Some(*number as i64)
            }
            _ => None,
        }
    }

    fn time(&self, index: usize) -> Option<Utc> {
        Utc::parse(&self.text(index)?)
    }
}

fn decode_project(row: &Row) -> Option<ProjectRow> {
    Some(ProjectRow {
        project_id: row.text(0)?,
        title: row.text(1)?,
        workspace_root: row.text(2)?,
        project_icon_json: row.nullable_text(3)?,
        favicon_path: row.nullable_text(4)?,
        auto_pull: row.integer(5)?,
        updated_at: row.time(6)?,
    })
}

fn worktree_from_payload(json: &str) -> Option<Option<String>> {
    match serde_json::from_str::<serde_json::Value>(json)
        .ok()?
        .get("worktreePath")?
    {
        serde_json::Value::Null => Some(None),
        serde_json::Value::String(path) => Some(Some(path.clone())),
        _ => None,
    }
}

fn decode_thread(row: &Row, layout: &Layout) -> Option<ThreadRow> {
    Some(ThreadRow {
        thread_id: row.text(0)?,
        project_id: row.text(1)?,
        title: row.text(2)?,
        worktree_path: if layout.worktree_in_payload {
            worktree_from_payload(&row.text(3)?)?
        } else {
            row.nullable_text(3)?
        },
        archived: row.integer(4)?,
        updated_at: row.time(5)?,
        waiting: row.integer(6)?,
        working: row.integer(7)?,
    })
}

enum Picked {
    None,
    Icon(ProjectIcon),
    Unreadable,
}

/// T3 Code's own icon format. A Lucide icon with monogram text shows as the monogram.
fn picked_icon(json: Option<&str>) -> Picked {
    let Some(json) = json else {
        return Picked::None;
    };
    let Ok(serde_json::Value::Object(icon)) = serde_json::from_str::<serde_json::Value>(json)
    else {
        return Picked::Unreadable;
    };
    let text = |key: &str| {
        icon.get(key)
            .and_then(|value| value.as_str())
            .map(String::from)
    };
    let colour = || text("color").filter(|colour| COLOURS.contains(&colour.as_str()));
    let optional_text = |key: &str| match icon.get(key) {
        None => Some(None),
        Some(serde_json::Value::String(value)) => Some(Some(value.clone())),
        Some(_) => None,
    };
    let decoded = match text("kind").as_deref() {
        Some("emoji") => text("emoji").map(|emoji| ProjectIcon::Emoji { emoji }),
        Some("monogram") => text("text")
            .zip(colour())
            .map(|(text, color)| ProjectIcon::Monogram { text, color }),
        Some("lucide") => (|| {
            let (name, color) = (text("name")?, colour()?);
            let (monogram_text, monogram) =
                (optional_text("monogramText")?, optional_text("monogram")?);

            Some(match monogram_text.or(monogram) {
                None => ProjectIcon::Lucide { name, color },
                Some(text) => ProjectIcon::Monogram { text, color },
            })
        })(),
        _ => None,
    };

    decoded.map_or(Picked::Unreadable, Picked::Icon)
}

/// T3 Code's own icon for a project with none: two characters of its name, such as `AS` for
/// "Agent Skills", in a colour picked from the name.
pub fn default_monogram(title: &str) -> ProjectIcon {
    let normalised = title.trim();
    let words: Vec<Vec<char>> = normalised
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .map(|word| word.chars().collect())
        .collect();
    let text = match words.first() {
        None => "PR".to_string(),
        Some(first) => {
            let start = first[0];
            let second = first[1..]
                .iter()
                .find(|character| character.is_numeric())
                .copied()
                .or_else(|| {
                    if words.len() > 1 {
                        words.last().and_then(|word| word.first().copied())
                    } else {
                        first.last().copied()
                    }
                })
                .unwrap_or(start);

            format!("{start}{second}")
                .to_uppercase()
                .chars()
                .take(2)
                .collect()
        }
    };
    let lowered = normalised.to_lowercase();
    let hashed = if lowered.is_empty() {
        "project"
    } else {
        &lowered
    };
    let hash = hashed.chars().fold(0u64, |hash, character| {
        (hash * 31 + character as u64) % COLOURS.len() as u64
    });

    ProjectIcon::Monogram {
        text,
        color: COLOURS[hash as usize].to_string(),
    }
}

/// The files T3 Code tries, in its order, when a project has no icon of its own.
const FAVICON_CANDIDATES: [&str; 21] = [
    "favicon.svg",
    "favicon.ico",
    "favicon.png",
    "public/favicon.svg",
    "public/favicon.ico",
    "public/favicon.png",
    "app/favicon.ico",
    "app/favicon.png",
    "app/icon.svg",
    "app/icon.png",
    "app/icon.ico",
    "src/favicon.ico",
    "src/favicon.svg",
    "src/app/favicon.ico",
    "src/app/icon.svg",
    "src/app/icon.png",
    "assets/icon.svg",
    "assets/icon.png",
    "assets/logo.svg",
    "assets/logo.png",
    ".idea/icon.svg",
];

fn image_type(extension: &str) -> Option<&'static str> {
    Some(match extension {
        ".avif" => "image/avif",
        ".gif" => "image/gif",
        ".ico" => "image/x-icon",
        ".jpeg" | ".jpg" => "image/jpeg",
        ".png" => "image/png",
        ".svg" => "image/svg+xml",
        ".webp" => "image/webp",
        _ => return None,
    })
}

/// Larger files are left out, since every dashboard downloads each icon.
const MAXIMUM_ICON_BYTES: u64 = 256 * 1024;

pub fn sha256_hex(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The path with symbolic links resolved, as Git reports checkouts, or None if it's missing.
pub fn real_path(path: &str) -> Option<String> {
    std::fs::canonicalize(path)
        .ok()
        .map(|resolved| resolved.to_string_lossy().into_owned())
}

/// The image at `relative_path` in the project folder, or None when there's no usable one. The
/// repository decides what's there, so a link out of the folder, such as `favicon.svg` pointing at
/// a private key, is refused, and a file that can't be read is simply not an icon.
fn read_image(folder: &str, relative_path: &str) -> Option<ProjectIconFile> {
    let file = real_path(&paths::resolve(folder, relative_path))?;
    let media_type = image_type(&paths::extname(&file).to_lowercase())?;

    if !paths::is_within(&file, folder) {
        return None;
    }

    let found = std::fs::metadata(&file).ok()?;

    if !found.is_file() || found.len() == 0 || found.len() > MAXIMUM_ICON_BYTES {
        return None;
    }

    let bytes = std::fs::read(&file).ok()?;

    Some(ProjectIconFile {
        id: sha256_hex(&bytes),
        media_type,
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

/// The image T3 Code shows for a project without a picked icon: the one set, or the first found.
fn find_favicon(folder: &str, favicon_path: Option<&str>) -> Option<ProjectIconFile> {
    match favicon_path {
        Some(path) => read_image(folder, path),
        None => FAVICON_CANDIDATES
            .iter()
            .find_map(|candidate| read_image(folder, candidate)),
    }
}

fn thread_state(row: &ThreadRow) -> T3CodeThreadState {
    if row.waiting != 0 {
        T3CodeThreadState::Waiting
    } else if row.working != 0 {
        T3CodeThreadState::Working
    } else {
        T3CodeThreadState::Idle
    }
}

/// How long an idle thread stays in the reading after it last changed.
const RECENT_THREAD_MILLIS: i64 = 14 * 24 * 60 * 60 * 1000;

struct Unreadable {
    message: String,
    schema: Option<T3CodeSchema>,
}

struct Rows {
    schema: T3CodeSchema,
    projects: Vec<ProjectRow>,
    unread_projects: Count,
    threads: Vec<ThreadRow>,
    unread_threads: Count,
}

fn query(database: &rusqlite::Connection, sql: &str) -> rusqlite::Result<Vec<Row>> {
    let mut statement = database.prepare(sql)?;
    let columns = statement.column_count();

    statement
        .query_map([], |row| {
            (0..columns)
                .map(|index| row.get::<_, Value>(index))
                .collect::<rusqlite::Result<Vec<_>>>()
                .map(Row)
        })?
        .collect()
}

/// Reads the rows FleetFrog uses in one read transaction, closing the database straight after. T3
/// Code keeps it in WAL mode, so reading never blocks its writes, and closing at once lets it
/// checkpoint the log. The read waits only briefly for a lock.
fn read_rows(file: &str) -> Result<Rows, Unreadable> {
    let failed = |error: rusqlite::Error| Unreadable {
        message: format!("Couldn't read T3 Code's database: {error}"),
        schema: None,
    };
    let database = rusqlite::Connection::open_with_flags(
        file,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(failed)?;

    database
        .busy_timeout(std::time::Duration::from_millis(500))
        .map_err(failed)?;
    database.execute_batch("begin").map_err(failed)?;

    let layout = if paths::basename(file) == V2_DATABASE {
        &V2_LAYOUT
    } else {
        &V1_LAYOUT
    };

    let schema = query(
        &database,
        "select migration_id, name from effect_sql_migrations order by migration_id desc",
    )
    .map_err(failed)?
    .iter()
    .find_map(|row| {
        Some(T3CodeSchema {
            migration: row.integer(0)?,
            name: row.text(1)?,
        })
    });
    let mut missing = Vec::new();

    for (table, columns) in REQUIRED_COLUMNS.iter().chain(layout.columns) {
        let mut statement = database
            .prepare("select name from pragma_table_info(?)")
            .map_err(failed)?;
        let present: Vec<String> = statement
            .query_map([table], |row| row.get::<_, String>(0))
            .map_err(failed)?
            .flatten()
            .collect();

        missing.extend(
            columns
                .iter()
                .filter(|column| !present.iter().any(|name| name == *column))
                .map(|column| format!("{table}.{column}")),
        );
    }

    if !missing.is_empty() {
        return Err(Unreadable {
            message: format!("T3 Code's database has no {}.", missing.join(", ")),
            schema,
        });
    }

    let Some(schema) = schema else {
        return Err(Unreadable {
            message: "T3 Code's database records no migrations.".into(),
            schema: None,
        });
    };
    let projects = query(
        &database,
        "select project_id, title, workspace_root, project_icon_json, favicon_path, auto_pull, updated_at
        from projection_projects where deleted_at is null",
    )
    .map_err(failed)?;
    let threads = query(&database, layout.threads).map_err(failed)?;

    database.execute_batch("commit").map_err(failed)?;

    let decoded_projects: Vec<ProjectRow> = projects.iter().filter_map(decode_project).collect();
    let decoded_threads: Vec<ThreadRow> = threads
        .iter()
        .filter_map(|row| decode_thread(row, layout))
        .collect();

    Ok(Rows {
        schema,
        unread_projects: (projects.len() - decoded_projects.len()) as Count,
        projects: decoded_projects,
        unread_threads: (threads.len() - decoded_threads.len()) as Count,
        threads: decoded_threads,
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeFile {
    pid: i64,
    port: i64,
    started_at: Utc,
}

/// Whether a process is running, including one this user may not signal.
fn is_running(pid: i64) -> bool {
    let Ok(pid) = libc::pid_t::try_from(pid) else {
        return false;
    };

    // SAFETY: signal 0 only checks that the process exists.
    pid > 0
        && (unsafe { libc::kill(pid, 0) } == 0
            || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM))
}

/// The program a process runs: from `/proc` on Linux, and from `ps` on macOS.
async fn executable_of(pid: i64) -> Option<String> {
    if let Ok(linked) = std::fs::read_link(format!("/proc/{pid}/exe")) {
        return Some(linked.to_string_lossy().into_owned());
    }

    let output = run_tool("ps", "/", &["-o", "comm=", "-p", &pid.to_string()])
        .await
        .ok()?;

    Some(output.trim().to_string()).filter(|name| !name.is_empty())
}

/// T3 Code's version from the program running its server: a folder named after the version when
/// it runs as a service, or the app's `Info.plist` when the app runs it.
pub fn version_of(executable: &str) -> Option<String> {
    if let Some(start) = executable.find("/runtime/versions/") {
        let rest = &executable[start + "/runtime/versions/".len()..];

        if let Some(end) = rest.find('/').filter(|end| *end > 0) {
            return Some(rest[..end].to_string());
        }
    }

    let app = &executable[..executable.find(".app/Contents/")? + ".app".len()];
    let plist = std::fs::read_to_string(paths::join(app, "Contents/Info.plist")).ok()?;
    let key = "<key>CFBundleShortVersionString</key>";
    let rest = plist[plist.find(key)? + key.len()..]
        .trim_start()
        .strip_prefix("<string>")?;
    let version = &rest[..rest.find('<')?];

    Some(version.to_string()).filter(|version| !version.is_empty())
}

/// T3 Code's server, if it's running. A runtime file left behind by a server that stopped, whose
/// process number now belongs to another program, counts as not running.
async fn read_server(userdata: &str) -> Option<T3CodeServer> {
    let text = std::fs::read_to_string(paths::join(userdata, "server-runtime.json")).ok()?;
    let runtime: RuntimeFile = serde_json::from_str(&text).ok()?;

    if !is_running(runtime.pid) {
        return None;
    }

    let executable = executable_of(runtime.pid).await;

    if executable
        .as_deref()
        .is_some_and(|executable| !paths::basename(executable).to_lowercase().contains("t3"))
    {
        return None;
    }

    Some(T3CodeServer {
        version: executable.as_deref().and_then(version_of),
        started_at: runtime.started_at,
        port: runtime.port,
    })
}

#[derive(Deserialize)]
struct Advisory {
    #[serde(rename = "latestVersion")]
    latest_version: Option<String>,
}

#[derive(Deserialize)]
struct Auth {
    status: String,
}

/// What T3 Code last found out about one coding agent. Its sign-in details are never read.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProviderFile {
    display_name: String,
    enabled: bool,
    status: String,
    version: Option<String>,
    #[serde(default)]
    version_advisory: Option<Advisory>,
    #[serde(default)]
    auth: Option<Auth>,
}

/// The coding agents turned on in T3 Code, by name, as it last checked them.
fn read_providers(caches: &str) -> Vec<T3CodeProvider> {
    let mut providers: Vec<T3CodeProvider> = std::fs::read_dir(caches)
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_name().to_string_lossy().ends_with(".json"))
                .filter_map(|entry| {
                    serde_json::from_str::<ProviderFile>(
                        &std::fs::read_to_string(entry.path()).ok()?,
                    )
                    .ok()
                })
                .filter(|provider| provider.enabled)
                .map(|provider| {
                    let latest = provider
                        .version_advisory
                        .and_then(|advisory| advisory.latest_version);

                    T3CodeProvider {
                        latest_version: latest
                            .filter(|latest| Some(latest) != provider.version.as_ref()),
                        name: provider.display_name,
                        version: provider.version,
                        ready: provider.status == "ready",
                        signed_in: provider
                            .auth
                            .is_some_and(|auth| auth.status == "authenticated"),
                    }
                })
                .collect()
        })
        .unwrap_or_default();

    providers.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.name.cmp(&right.name))
    });
    providers
}

pub struct T3CodeRead {
    pub status: T3CodeStatus,
    pub icons: Vec<ProjectIconFile>,
}

/// Each project's favicon by folder and set path, looked for again on every discovery walk.
pub type Favicons = HashMap<String, Option<ProjectIconFile>>;

/// What T3 Code has on this machine: its projects and their threads, and with `project_icons`, the
/// image files its projects show as icons.
pub async fn read_t3code(
    database: &str,
    project_icons: bool,
    favicons: &mut Favicons,
) -> T3CodeRead {
    // The database sits in T3 Code's `userdata` folder, beside its runtime file and below its home.
    let userdata = paths::dirname(database);
    let server = read_server(&userdata).await;
    let providers = read_providers(&paths::join(&paths::dirname(&userdata), "caches"));
    let status = |reading: T3CodeReading| T3CodeStatus {
        database: database.to_string(),
        reading,
        server: server.clone(),
        providers: providers.clone(),
    };

    if !std::fs::metadata(database).is_ok_and(|found| found.is_file()) {
        return T3CodeRead {
            status: status(T3CodeReading::NotFound),
            icons: Vec::new(),
        };
    }

    let file = database.to_string();
    let rows = match tokio::task::spawn_blocking(move || read_rows(&file)).await {
        Ok(Ok(rows)) => rows,
        Ok(Err(unreadable)) => {
            return T3CodeRead {
                status: status(T3CodeReading::Unreadable {
                    message: unreadable.message,
                    schema: unreadable.schema,
                }),
                icons: Vec::new(),
            };
        }
        Err(error) => {
            return T3CodeRead {
                status: status(T3CodeReading::Unreadable {
                    message: format!("Couldn't read T3 Code's database: {error}"),
                    schema: None,
                }),
                icons: Vec::new(),
            };
        }
    };
    let mut icons: Vec<ProjectIconFile> = Vec::new();
    let mut unread_icons: Count = 0;
    let mut projects = Vec::new();

    for row in &rows.projects {
        let folder = real_path(&row.workspace_root).unwrap_or_else(|| row.workspace_root.clone());
        // An icon that can't be read falls back to what T3 Code shows for a project without one.
        let own = match picked_icon(row.project_icon_json.as_deref()) {
            Picked::Icon(icon) => Some(icon),
            Picked::None => None,
            Picked::Unreadable => {
                unread_icons += 1;
                None
            }
        };
        let image = if own.is_none() && project_icons {
            let key = format!("{folder}\0{}", row.favicon_path.as_deref().unwrap_or(""));

            favicons
                .entry(key)
                .or_insert_with(|| find_favicon(&folder, row.favicon_path.as_deref()))
                .clone()
        } else {
            None
        };

        if let Some(image) = &image
            && !icons.iter().any(|known| known.id == image.id)
        {
            icons.push(image.clone());
        }

        projects.push(T3CodeProject {
            id: row.project_id.clone(),
            title: row.title.clone(),
            icon: Some(match image {
                Some(image) => ProjectIcon::Image { id: image.id },
                None => own.unwrap_or_else(|| default_monogram(&row.title)),
            }),
            path: folder,
            auto_pull: row.auto_pull != 0,
            updated_at: row.updated_at,
        });
    }

    let folders: HashMap<&str, &str> = projects
        .iter()
        .map(|project| (project.id.as_str(), project.path.as_str()))
        .collect();
    let recent_since = Utc::now().millis() - RECENT_THREAD_MILLIS;
    // A thread of a deleted project has nowhere to work, so it's left out.
    let threads: Vec<T3CodeThread> = rows
        .threads
        .iter()
        .filter_map(|row| {
            let folder = folders.get(row.project_id.as_str())?;

            Some(T3CodeThread {
                id: row.thread_id.clone(),
                project_id: row.project_id.clone(),
                title: row.title.clone(),
                path: match &row.worktree_path {
                    None => folder.to_string(),
                    Some(path) => real_path(path).unwrap_or_else(|| path.clone()),
                },
                worktree: row.worktree_path.is_some(),
                state: thread_state(row),
                archived: row.archived != 0,
                updated_at: row.updated_at,
            })
        })
        .collect();
    let thread_count = threads.iter().filter(|thread| !thread.archived).count() as Count;
    let mut shown: Vec<T3CodeThread> = threads
        .into_iter()
        .filter(|thread| {
            thread.worktree
                || (!thread.archived
                    && (thread.state != T3CodeThreadState::Idle
                        || thread.updated_at.millis() >= recent_since))
        })
        .collect();

    shown.sort_by_key(|thread| std::cmp::Reverse(thread.updated_at));

    T3CodeRead {
        status: status(T3CodeReading::Read {
            schema: rows.schema,
            projects,
            threads: shown,
            thread_count,
            unread_records: rows.unread_projects + rows.unread_threads + unread_icons,
        }),
        icons,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monogram(title: &str) -> (String, String) {
        match default_monogram(title) {
            ProjectIcon::Monogram { text, color } => (text, color),
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn makes_monograms_as_t3_code_does() {
        assert_eq!(monogram("Agent Skills").0, "AS");
        assert_eq!(monogram("fleetfrog").0, "FG");
        assert_eq!(monogram("web3 app").0, "W3");
        assert_eq!(monogram("").0, "PR");
        assert_eq!(monogram("x").0, "XX");
    }

    #[test]
    fn reads_picked_icons() {
        assert!(matches!(
            picked_icon(Some(r#"{"kind":"emoji","emoji":"🐸"}"#)),
            Picked::Icon(ProjectIcon::Emoji { .. })
        ));
        assert!(matches!(
            picked_icon(Some(
                r#"{"kind":"lucide","name":"git-branch","color":"red","monogramText":"FF"}"#
            )),
            Picked::Icon(ProjectIcon::Monogram { .. })
        ));
        assert!(matches!(
            picked_icon(Some(r#"{"kind":"lucide","name":"x","color":"mauve"}"#)),
            Picked::Unreadable
        ));
        assert!(matches!(picked_icon(None), Picked::None));
    }

    #[test]
    fn finds_versions_in_executable_paths() {
        assert_eq!(
            version_of("/home/me/.t3/runtime/versions/0.0.43/bin/t3").as_deref(),
            Some("0.0.43")
        );
        assert_eq!(version_of("/usr/bin/t3"), None);
    }
}
