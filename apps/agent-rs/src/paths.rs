//! POSIX path handling as Node's `path.posix` does it, and the folder checks the protocol package
//! shares with the hub and dashboard (`cloneDestination.ts` and `archiveFolder.ts`).

/// The home directory as Node's `os.homedir()` finds it: `HOME`, or else the user's account.
pub fn home() -> String {
    if let Some(home) = std::env::var_os("HOME").filter(|home| !home.is_empty()) {
        return home.to_string_lossy().into_owned();
    }

    // SAFETY: `getpwuid` returns a pointer into static storage that is read before any other call.
    unsafe {
        let entry = libc::getpwuid(libc::getuid());

        if entry.is_null() || (*entry).pw_dir.is_null() {
            return "/".into();
        }

        std::ffi::CStr::from_ptr((*entry).pw_dir)
            .to_string_lossy()
            .into_owned()
    }
}

/// An environment variable that is set and not empty.
pub fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|value| !value.is_empty())
}

/// Joins and normalises, as `path.join` does.
pub fn join(base: &str, rest: &str) -> String {
    if rest.is_empty() {
        return normalize(base);
    }

    if base.is_empty() {
        return normalize(rest);
    }

    normalize(&format!("{base}/{rest}"))
}

/// Resolves `target` against the absolute `base`, as `path.resolve` does.
pub fn resolve(base: &str, target: &str) -> String {
    let joined = if target.starts_with('/') {
        normalize(target)
    } else {
        join(base, target)
    };

    if joined.len() > 1 {
        joined.trim_end_matches('/').to_string()
    } else {
        joined
    }
}

/// Collapses `.`, `..` and repeated slashes, keeping a trailing slash, as `path.normalize` does.
pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".into();
    }

    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut parts: Vec<&str> = Vec::new();

    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.last().is_some_and(|last| *last != "..") {
                    parts.pop();
                } else if !absolute {
                    parts.push("..");
                }
            }
            _ => parts.push(part),
        }
    }

    let mut normalised = parts.join("/");

    if normalised.is_empty() && !absolute {
        normalised.push('.');
    }

    if trailing && !normalised.is_empty() && normalised != "." {
        normalised.push('/');
    }

    if absolute {
        format!("/{normalised}")
    } else {
        normalised
    }
}

pub fn dirname(path: &str) -> String {
    let trimmed = if path.len() > 1 {
        path.trim_end_matches('/')
    } else {
        path
    };

    match trimmed.rfind('/') {
        None => ".".into(),
        Some(0) => "/".into(),
        Some(index) => match trimmed[..index].trim_end_matches('/') {
            "" => "/".into(),
            parent => parent.to_string(),
        },
    }
}

pub fn basename(path: &str) -> String {
    let trimmed = path.trim_end_matches('/');

    trimmed.rsplit('/').next().unwrap_or("").to_string()
}

/// The path from `from` to `to`, both absolute, as `path.relative` does.
pub fn relative(from: &str, to: &str) -> String {
    let from = resolve("/", from);
    let to = resolve("/", to);
    let from_parts: Vec<&str> = from.split('/').filter(|part| !part.is_empty()).collect();
    let to_parts: Vec<&str> = to.split('/').filter(|part| !part.is_empty()).collect();
    let shared = from_parts
        .iter()
        .zip(&to_parts)
        .take_while(|(left, right)| left == right)
        .count();
    let mut parts: Vec<&str> = vec![".."; from_parts.len() - shared];

    parts.extend(&to_parts[shared..]);
    parts.join("/")
}

/// The file's extension including its dot, or empty, as `path.extname` does.
pub fn extname(path: &str) -> String {
    let name = basename(path);

    match name.rfind('.') {
        Some(index) if index > 0 => name[index..].to_string(),
        _ => String::new(),
    }
}

/// Expands a leading `~` against the machine's home directory.
pub fn expand_home(path: &str, home: &str) -> String {
    if path == "~" {
        return home.to_string();
    }

    match path.strip_prefix("~/") {
        Some(rest) => format!("{}/{rest}", home.trim_end_matches('/')),
        None => path.to_string(),
    }
}

fn without_trailing_slashes(path: &str) -> &str {
    if path.len() > 1 {
        path.trim_end_matches('/')
    } else {
        path
    }
}

/// True when `path` is strictly below `folder`. Both must be absolute.
fn is_below(path: &str, folder: &str) -> bool {
    let prefix = if folder == "/" {
        "/".to_string()
    } else {
        format!("{folder}/")
    };

    path.starts_with(&prefix) && path.len() > prefix.len()
}

/// True when `path` is `folder` itself or anywhere below it. Both must be absolute.
pub fn is_within(path: &str, folder: &str) -> bool {
    let normalised = without_trailing_slashes(folder);

    path == normalised || is_below(path, normalised)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FolderPathCheck {
    Valid(String),
    NotAbsolute,
    /// A hidden folder such as `~/.config`, or one reached through `.` or `..`.
    Hidden,
}

/// Checks a folder path that needs no file system: an absolute or `~` path with no hidden, `.` or
/// `..` segments. Returns it expanded, without trailing slashes.
pub fn check_folder_path(path: &str, home: &str) -> FolderPathCheck {
    let expanded = expand_home(path.trim(), home);
    let path = without_trailing_slashes(&expanded);

    if !path.starts_with('/') {
        return FolderPathCheck::NotAbsolute;
    }

    // An empty segment from `//` would make the path compare unlike the folder it is in.
    if path
        .split('/')
        .skip(1)
        .any(|segment| segment.is_empty() || segment.starts_with('.'))
    {
        FolderPathCheck::Hidden
    } else {
        FolderPathCheck::Valid(path.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DestinationCheck {
    Valid { path: String, root: String },
    NotAbsolute,
    Hidden,
    OutsideRoots,
    InArchive,
}

/// Checks the parts of a clone destination that need no file system: strictly inside one of the
/// machine's discovery folders, outside the Archive folder, with no hidden segments.
pub fn check_clone_destination(
    destination: &str,
    home: &str,
    roots: &[String],
    archive: Option<&str>,
) -> DestinationCheck {
    let path = match check_folder_path(destination, home) {
        FolderPathCheck::Valid(path) => path,
        FolderPathCheck::NotAbsolute => return DestinationCheck::NotAbsolute,
        FolderPathCheck::Hidden => return DestinationCheck::Hidden,
    };
    let Some(root) = roots.iter().find(|candidate| {
        is_below(
            &path,
            without_trailing_slashes(&expand_home(candidate, home)),
        )
    }) else {
        return DestinationCheck::OutsideRoots;
    };

    if archive.is_some_and(|archive| is_within(&path, &expand_home(archive, home))) {
        DestinationCheck::InArchive
    } else {
        DestinationCheck::Valid {
            path,
            root: root.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ArchiveFolderCheck {
    Valid(String),
    NotAbsolute,
    Hidden,
    /// The archive would hold a project folder, which discovery would then stop searching.
    ContainsProjectFolder,
}

/// Checks the Archive folder against this machine's project folders. Returns it expanded.
pub fn check_archive_folder(folder: &str, home: &str, roots: &[String]) -> ArchiveFolderCheck {
    let path = match check_folder_path(folder, home) {
        FolderPathCheck::Valid(path) => path,
        FolderPathCheck::NotAbsolute => return ArchiveFolderCheck::NotAbsolute,
        FolderPathCheck::Hidden => return ArchiveFolderCheck::Hidden,
    };

    if roots
        .iter()
        .any(|candidate| is_within(&expand_home(candidate, home), &path))
    {
        ArchiveFolderCheck::ContainsProjectFolder
    } else {
        ArchiveFolderCheck::Valid(path)
    }
}

fn last_segment(path: &str) -> &str {
    path.split('/').rfind(|part| !part.is_empty()).unwrap_or("")
}

/// Where archiving the checkout at `path` moves it: the same path below the Archive folder as it
/// has below its project folder, or its folder name when it's in none of them.
pub fn archive_destination(path: &str, archive: &str, home: &str, roots: &[String]) -> String {
    let root = roots
        .iter()
        .map(|candidate| {
            expand_home(candidate, home)
                .trim_end_matches('/')
                .to_string()
        })
        .find(|candidate| is_within(path, candidate) && path != candidate);
    let relative = match root {
        None => last_segment(path),
        Some(root) => &path[root.len() + 1..],
    };

    format!("{}/{relative}", archive.trim_end_matches('/'))
}

/// Where unarchiving the checkout at `path` moves it: back where it was archived from when that is
/// still inside a project folder, or else the same path below the first project folder as it has
/// below the Archive folder. None when the machine has no project folders.
pub fn unarchive_destination(
    path: &str,
    original_path: Option<&str>,
    archive: &str,
    home: &str,
    roots: &[String],
) -> Option<String> {
    let roots: Vec<String> = roots
        .iter()
        .map(|root| expand_home(root, home).trim_end_matches('/').to_string())
        .collect();

    if let Some(original) = original_path
        && roots
            .iter()
            .any(|root| is_within(original, root) && original != root)
    {
        return Some(original.to_string());
    }

    let first = roots.first()?;
    let archive = archive.trim_end_matches('/');
    let relative = if is_within(path, archive) {
        &path[(archive.len() + 1).min(path.len())..]
    } else {
        last_segment(path)
    };

    Some(format!("{first}/{relative}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_like_node() {
        assert_eq!(join("/a/b", "../c"), "/a/c");
        assert_eq!(join("/a/", "b/"), "/a/b/");
        assert_eq!(resolve("/a/b", "c/"), "/a/b/c");
        assert_eq!(resolve("/a/b", "/x/../y"), "/y");
        assert_eq!(dirname("/a/b/c"), "/a/b");
        assert_eq!(dirname("/a"), "/");
        assert_eq!(basename("/a/b/"), "b");
        assert_eq!(relative("/a/b", "/a/b/c/d"), "c/d");
        assert_eq!(relative("/a/b", "/a/x"), "../x");
        assert_eq!(extname("/a/favicon.SVG"), ".SVG");
        assert_eq!(extname("/a/.hidden"), "");
    }

    #[test]
    fn checks_clone_destinations() {
        let roots = vec!["~/Projects".to_string()];

        assert_eq!(
            check_clone_destination(
                "~/Projects/app",
                "/home/me",
                &roots,
                Some("~/Projects/Archive")
            ),
            DestinationCheck::Valid {
                path: "/home/me/Projects/app".into(),
                root: "~/Projects".into()
            }
        );
        assert_eq!(
            check_clone_destination("~/Projects", "/home/me", &roots, None),
            DestinationCheck::OutsideRoots
        );
        assert_eq!(
            check_clone_destination("~/Projects/.x/app", "/home/me", &roots, None),
            DestinationCheck::Hidden
        );
        assert_eq!(
            check_clone_destination("Projects/app", "/home/me", &roots, None),
            DestinationCheck::NotAbsolute
        );
        assert_eq!(
            check_clone_destination(
                "~/Projects/Archive/app",
                "/home/me",
                &roots,
                Some("~/Projects/Archive")
            ),
            DestinationCheck::InArchive
        );
    }

    #[test]
    fn places_archived_checkouts() {
        let roots = vec!["~/Projects".to_string()];

        assert_eq!(
            archive_destination("/h/Projects/a/b", "/h/Archive", "/h", &roots),
            "/h/Archive/a/b"
        );
        assert_eq!(
            archive_destination("/elsewhere/b", "/h/Archive/", "/h", &roots),
            "/h/Archive/b"
        );
        assert_eq!(
            unarchive_destination(
                "/h/Archive/a/b",
                Some("/h/Projects/x"),
                "/h/Archive",
                "/h",
                &roots
            )
            .as_deref(),
            Some("/h/Projects/x")
        );
        assert_eq!(
            unarchive_destination(
                "/h/Archive/a/b",
                Some("/gone/x"),
                "/h/Archive",
                "/h",
                &roots
            )
            .as_deref(),
            Some("/h/Projects/a/b")
        );
        assert_eq!(
            unarchive_destination("/h/Archive/a", None, "/h/Archive", "/h", &[]),
            None
        );
        assert_eq!(
            check_archive_folder("~", "/h", &roots),
            ArchiveFolderCheck::ContainsProjectFolder
        );
    }
}
