//! What the agent reports about the machine it runs on. Values follow what Node's `os` module
//! reports for the TypeScript agent, so the dashboard shows the same thing from either.

use crate::discovery::root_path;
use crate::paths;
use crate::process::run_tool;
use crate::protocol::{
    Cpu, Disk, GithubCli, MachineInfo, MachineModel, SystemInfo, SystemUsage, Versions,
};
use crate::time::Utc;

pub const AGENT_VERSION: &str = env!("FLEETFROG_AGENT_VERSION");

pub fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

fn is_mac() -> bool {
    cfg!(target_os = "macos")
}

pub fn hostname() -> String {
    let mut buffer = [0u8; 256];

    // SAFETY: `gethostname` writes at most the buffer's length.
    let result = unsafe { libc::gethostname(buffer.as_mut_ptr().cast(), buffer.len()) };

    if result != 0 {
        return "localhost".into();
    }

    let end = buffer
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(buffer.len());

    String::from_utf8_lossy(&buffer[..end]).into_owned()
}

fn read_trimmed(file: &str) -> Option<String> {
    let text = std::fs::read_to_string(file).ok()?;
    let text = text.trim();

    (!text.is_empty()).then(|| text.to_string())
}

/// A `KEY=value` line's value from a shell-style file, such as `/etc/os-release`.
fn assignment(text: &str, key: &str) -> Option<String> {
    text.lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix('='))
        .map(|value| value.trim().to_string())
}

/// The name the user gave the machine: systemd's pretty hostname on Linux, the computer name on macOS.
async fn read_pretty_name() -> Option<String> {
    if is_mac() {
        let name = run_tool("scutil", &paths::home(), &["--get", "ComputerName"])
            .await
            .ok()?;

        return Some(name.trim().to_string()).filter(|name| !name.is_empty());
    }

    let value = assignment(
        &std::fs::read_to_string("/etc/machine-info").unwrap_or_default(),
        "PRETTY_HOSTNAME",
    )?;
    let unquoted = value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(&value);

    Some(unquoted.to_string()).filter(|name| !name.is_empty())
}

async fn read_github_cli() -> GithubCli {
    match run_tool("gh", &paths::home(), &["api", "user", "--jq", ".login"]).await {
        Ok(login) => GithubCli::Available {
            login: login.trim().to_string(),
        },
        Err(_) => GithubCli::Unavailable {
            reason: "gh is not installed or not signed in".into(),
        },
    }
}

pub async fn read_machine_info() -> MachineInfo {
    MachineInfo {
        hostname: hostname(),
        pretty_name: read_pretty_name().await,
        platform: platform(),
        home_directory: paths::home(),
        agent_version: AGENT_VERSION.to_string(),
        agent_runtime: "rust",
        github_cli: read_github_cli().await,
        system: Some(read_system_info().await),
    }
}

const COMMON_ROOTS: [&str; 5] = ["~/Projects", "~/projects", "~/code", "~/src", "~/dev"];

/// Common development folders that exist here, offered as the first discovery roots.
pub fn suggest_discovery_roots() -> Vec<String> {
    let existing: Vec<String> = COMMON_ROOTS
        .iter()
        .filter(|root| std::fs::metadata(root_path(root)).is_ok())
        .map(|root| root.to_string())
        .collect();

    // Case-insensitive file systems report both spellings of the same folder.
    if existing.iter().any(|root| root == "~/Projects") {
        existing
            .into_iter()
            .filter(|root| root != "~/projects")
            .collect()
    } else {
        existing
    }
}

/// The distribution's own name for itself from `/etc/os-release`, such as "Ubuntu 26.04 LTS".
pub fn parse_os_release(text: &str) -> Option<String> {
    let value = assignment(text, "PRETTY_NAME")?;
    let unquoted = ['"', '\'']
        .iter()
        .find_map(|quote| {
            value
                .strip_prefix(*quote)?
                .strip_suffix(*quote)
                .filter(|_| value.len() >= 2)
        })
        .unwrap_or(&value);

    Some(unquoted.to_string()).filter(|name| !name.is_empty())
}

/// The version number from `git --version`, such as "2.53.0" from "git version 2.53.0".
pub fn parse_git_version(output: &str) -> Option<String> {
    let rest = &output[output.find("git version ")? + "git version ".len()..];
    let version: String = rest
        .chars()
        .take_while(|character| !character.is_whitespace())
        .collect();

    Some(version).filter(|version| !version.is_empty())
}

const IMPORTANT_CAPACITY_SCRIPT: &str = "ObjC.import(\"Foundation\");
function run(argv) {
  const value = Ref();
  $.NSURL.fileURLWithPath(argv[0]).getResourceValueForKeyError(value, $.NSURLVolumeAvailableCapacityForImportantUsageKey, null);
  return ObjC.unwrap(value[0]);
}";

pub fn parse_important_capacity(output: &str) -> Option<u64> {
    output.trim().parse().ok()
}

/// Memory in use from `vm_stat`, counted as Activity Monitor does: app memory (anonymous pages
/// that can't be purged), wired memory and the compressor's pages. File caches don't count.
pub fn parse_vm_stat(output: &str) -> Option<u64> {
    let page_bytes: u64 = {
        let rest = &output[output.find("page size of ")? + "page size of ".len()..];

        rest.split(' ').next()?.parse().ok()?
    };
    let pages = |name: &str| -> Option<u64> {
        output.lines().find_map(|line| {
            let (key, value) = line.split_once(':')?;

            (key.trim_matches('"') == name).then(|| value.trim().strip_suffix('.')?.parse().ok())?
        })
    };
    let anonymous = pages("Anonymous pages")?;
    let purgeable = pages("Pages purgeable")?;
    let wired = pages("Pages wired down")?;
    let compressed = pages("Pages occupied by compressor")?;

    Some((anonymous.saturating_sub(purgeable) + wired + compressed) * page_bytes)
}

/// The Mac's model from `ioreg`, as About This Mac shows it: "MacBook Pro (13-inch, M1, 2020)"
/// becomes "MacBook Pro" with "13-inch, M1, 2020".
pub fn parse_product_name(output: &str) -> Option<MachineModel> {
    let marker = "\"product-name\" = <\"";
    let rest = &output[output.find(marker)? + marker.len()..];
    let full = rest[..rest.find('"')?].trim();

    if full.is_empty() {
        return None;
    }

    if let Some(open) = full.find(" (")
        && full.ends_with(')')
        && open > 0
    {
        let detail = &full[open + 2..full.len() - 1];

        if !detail.is_empty() {
            return Some(MachineModel {
                name: full[..open].to_string(),
                detail: Some(detail.to_string()),
            });
        }
    }

    Some(MachineModel {
        name: full.to_string(),
        detail: None,
    })
}

/// The hypervisor's name from `systemd-detect-virt --vm`, or None on a physical machine.
pub fn parse_hypervisor(output: &str) -> Option<String> {
    let id = output.trim();
    let name = match id {
        "" | "none" => return None,
        "kvm" => "KVM",
        "qemu" => "QEMU",
        "vmware" => "VMware",
        "microsoft" => "Hyper-V",
        "oracle" => "VirtualBox",
        "xen" => "Xen",
        "parallels" => "Parallels",
        "apple" => "Apple Virtualization",
        "bhyve" => "bhyve",
        "amazon" => "Amazon EC2",
        "google" => "Google Compute Engine",
        other => other,
    };

    Some(name.to_string())
}

/// Apple's marketing names and model identifiers share these prefixes, such as "Mac mini" and
/// "Macmini8,1".
pub fn kind_from_apple_name(name: &str) -> Option<&'static str> {
    let compact: String = name.to_lowercase().split_whitespace().collect();

    if compact.starts_with("macmini") {
        Some("mac-mini")
    } else if compact.starts_with("macstudio") {
        Some("mac-studio")
    } else if compact.starts_with("macbook") {
        Some("laptop")
    } else if compact.starts_with("imac") || compact.starts_with("macpro") {
        Some("desktop")
    } else {
        None
    }
}

/// SMBIOS enclosure types. Codes that describe a shape rather than a machine have no kind.
fn chassis_kind(code: &str) -> Option<&'static str> {
    match code {
        "3" | "4" | "5" | "6" | "7" | "13" | "15" | "16" | "35" => Some("desktop"),
        "8" | "9" | "10" | "14" | "31" | "32" => Some("laptop"),
        "17" | "18" | "19" | "20" | "21" | "22" | "23" | "24" | "28" => Some("server"),
        _ => None,
    }
}

/// Hypervisors and cloud providers that name themselves in the firmware's vendor or product.
/// Hyper-V is matched on its "Virtual Machine" product, not the vendor Surface devices share.
const VIRTUAL_MARKERS: [&str; 18] = [
    "qemu",
    "kvm",
    "bochs",
    "vmware",
    "virtualbox",
    "innotek",
    "xen",
    "parallels",
    "amazon ec2",
    "google compute engine",
    "digitalocean",
    "hetzner",
    "linode",
    "vultr",
    "scaleway",
    "openstack",
    "cloud",
    "virtual machine",
];

/// A Linux machine's kind from its firmware tables. Any virtual machine reads as a cloud VM.
pub fn kind_from_firmware(
    chassis_type: Option<&str>,
    vendor: Option<&str>,
    product: Option<&str>,
) -> Option<&'static str> {
    let product = product.unwrap_or("");
    let vendor_and_product = format!("{} {product}", vendor.unwrap_or("")).to_lowercase();

    if VIRTUAL_MARKERS
        .iter()
        .any(|marker| vendor_and_product.contains(marker))
    {
        return Some("cloud");
    }

    // Apple hardware running Linux still reports its Apple product name.
    kind_from_apple_name(product).or_else(|| chassis_kind(chassis_type?))
}

#[cfg(target_os = "macos")]
fn sysctl_string(name: &str) -> Option<String> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut length: libc::size_t = 0;

    // SAFETY: the first call asks for the length, the second fills a buffer of that length.
    unsafe {
        if libc::sysctlbyname(
            name.as_ptr(),
            std::ptr::null_mut(),
            &mut length,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }

        let mut buffer = vec![0u8; length];

        if libc::sysctlbyname(
            name.as_ptr(),
            buffer.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        ) != 0
        {
            return None;
        }

        let end = buffer
            .iter()
            .position(|byte| *byte == 0)
            .unwrap_or(buffer.len());

        Some(String::from_utf8_lossy(&buffer[..end]).into_owned())
    }
}

#[cfg(not(target_os = "macos"))]
fn sysctl_string(_name: &str) -> Option<String> {
    None
}

#[cfg(not(target_os = "macos"))]
fn sysctl_number<T>(_name: &str) -> Option<T> {
    None
}

#[cfg(target_os = "macos")]
fn sysctl_number<T: Default + Copy>(name: &str) -> Option<T> {
    let name = std::ffi::CString::new(name).ok()?;
    let mut value = T::default();
    let mut length = std::mem::size_of::<T>();

    // SAFETY: the value is written into a variable of the size passed.
    let result = unsafe {
        libc::sysctlbyname(
            name.as_ptr(),
            (&mut value as *mut T).cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };

    (result == 0).then_some(value)
}

/// The machine's kind for its icon, detected as T3 Code does. None without a usable signal.
async fn read_kind(model: Option<&MachineModel>, hypervisor: Option<&str>) -> Option<&'static str> {
    if is_mac() {
        // Intel Macs have no marketing name, but their model identifier shares its prefix.
        if let Some(kind) = model.and_then(|model| kind_from_apple_name(&model.name)) {
            return Some(kind);
        }

        return run_tool("sysctl", &paths::home(), &["-n", "hw.model"])
            .await
            .ok()
            .and_then(|model| kind_from_apple_name(&model));
    }

    // WSL names Microsoft in its kernel release, and WSL 2 would otherwise read as a Hyper-V VM.
    if read_trimmed("/proc/sys/kernel/osrelease")
        .is_some_and(|release| release.to_lowercase().contains("microsoft"))
    {
        return Some("linux");
    }

    if hypervisor.is_some() {
        return Some("cloud");
    }

    kind_from_firmware(
        read_trimmed("/sys/class/dmi/id/chassis_type").as_deref(),
        read_trimmed("/sys/class/dmi/id/sys_vendor").as_deref(),
        read_trimmed("/sys/class/dmi/id/product_name").as_deref(),
    )
}

async fn read_os_name() -> String {
    if is_mac() {
        let home = paths::home();
        let (name, version) = tokio::join!(
            run_tool("sw_vers", &home, &["-productName"]),
            run_tool("sw_vers", &home, &["-productVersion"])
        );

        return match (name, version) {
            (Ok(name), Ok(version)) => format!("{} {}", name.trim(), version.trim())
                .trim()
                .to_string(),
            _ => "macOS".into(),
        };
    }

    parse_os_release(&std::fs::read_to_string("/etc/os-release").unwrap_or_default())
        .unwrap_or_else(|| "Linux".into())
}

/// Node's name for the processor architecture.
fn architecture() -> String {
    match std::env::consts::ARCH {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        "x86" => "ia32",
        "arm" => "arm",
        "powerpc64" => "ppc64",
        "s390x" => "s390x",
        "riscv64" => "riscv64",
        "loongarch64" => "loong64",
        other => other,
    }
    .to_string()
}

fn cpu_model() -> String {
    let model = if is_mac() {
        sysctl_string("machdep.cpu.brand_string")
    } else {
        std::fs::read_to_string("/proc/cpuinfo")
            .ok()
            .and_then(|info| {
                info.lines().find_map(|line| {
                    let (key, value) = line.split_once(':')?;

                    matches!(key.trim(), "model name" | "Processor" | "cpu model")
                        .then(|| value.trim().to_string())
                })
            })
    };

    model
        .map(|model| model.trim().to_string())
        .filter(|model| !model.is_empty())
        .unwrap_or_else(|| "Unknown".into())
}

/// `/proc/meminfo`'s value for a key, in bytes.
fn meminfo(key: &str) -> Option<u64> {
    let info = std::fs::read_to_string("/proc/meminfo").ok()?;
    let value = info
        .lines()
        .find_map(|line| line.strip_prefix(key)?.strip_prefix(':'))?;

    value
        .trim()
        .trim_end_matches("kB")
        .trim()
        .parse::<u64>()
        .ok()
        .map(|kilobytes| kilobytes * 1024)
}

fn total_memory() -> u64 {
    if is_mac() {
        sysctl_number::<u64>("hw.memsize").unwrap_or(0)
    } else {
        meminfo("MemTotal").unwrap_or(0)
    }
}

fn uptime_seconds() -> f64 {
    if is_mac() {
        let boot = sysctl_number::<libc::timeval>("kern.boottime");

        return boot
            .map(|boot| {
                (Utc::now().millis() as f64 / 1000.0)
                    - boot.tv_sec as f64
                    - boot.tv_usec as f64 / 1e6
            })
            .unwrap_or(0.0);
    }

    read_trimmed("/proc/uptime")
        .and_then(|text| text.split(' ').next()?.parse().ok())
        .unwrap_or(0.0)
}

/// Hardware and software facts, read once per connection.
pub async fn read_system_info() -> SystemInfo {
    let git = run_tool("git", &paths::home(), &["--version"])
        .await
        .ok()
        .and_then(|output| parse_git_version(&output));
    let now = Utc::now();
    // Apple silicon Macs name themselves; Linux has no dependable equivalent.
    let model = if is_mac() {
        run_tool(
            "ioreg",
            &paths::home(),
            &["-rc", "IOPlatformDevice", "-k", "product-name"],
        )
        .await
        .ok()
        .and_then(|output| parse_product_name(&output))
    } else {
        None
    };
    // It exits with a failure on a physical machine, which reads as no hypervisor.
    let hypervisor = if is_mac() {
        None
    } else {
        run_tool("systemd-detect-virt", &paths::home(), &["--vm"])
            .await
            .ok()
            .and_then(|output| parse_hypervisor(&output))
    };

    SystemInfo {
        os: read_os_name().await,
        kind: read_kind(model.as_ref(), hypervisor.as_deref()).await,
        model,
        hypervisor,
        architecture: architecture(),
        cpu: Cpu {
            model: cpu_model(),
            cores: std::thread::available_parallelism()
                .map(|count| count.get() as u64)
                .unwrap_or(1),
        },
        memory_bytes: total_memory(),
        booted_at: Utc::from_millis(now.millis() - (uptime_seconds().round() as i64) * 1000),
        versions: Versions { node: None, git },
    }
}

async fn read_memory_used() -> Option<u64> {
    if is_mac() {
        // Free pages alone are a sliver on macOS, which keeps its caches full.
        return run_tool("vm_stat", &paths::home(), &[])
            .await
            .ok()
            .and_then(|output| parse_vm_stat(&output));
    }

    // Available memory leaves out caches the kernel can reclaim.
    Some(meminfo("MemTotal")?.saturating_sub(meminfo("MemAvailable")?))
}

async fn read_purgeable(folder: &str, free_bytes: u64) -> u64 {
    if !is_mac() {
        return 0;
    }

    run_tool(
        "osascript",
        folder,
        &["-l", "JavaScript", "-e", IMPORTANT_CAPACITY_SCRIPT, folder],
    )
    .await
    .ok()
    .and_then(|output| parse_important_capacity(&output))
    .map_or(0, |available| available.saturating_sub(free_bytes))
}

async fn read_disk(folder: &str) -> Option<Disk> {
    let path = std::ffi::CString::new(folder).ok()?;

    // SAFETY: `statvfs` fills the zeroed struct for the NUL-terminated path.
    let stats = unsafe {
        let mut stats: libc::statvfs = std::mem::zeroed();

        if libc::statvfs(path.as_ptr(), &mut stats) != 0 {
            return None;
        }

        stats
    };
    let block = stats.f_frsize as u64;
    // Space an unprivileged user can use, which is what a clone or install can fill.
    let free_bytes = stats.f_bavail as u64 * block;

    Some(Disk {
        total_bytes: stats.f_blocks as u64 * block,
        free_bytes,
        purgeable_bytes: read_purgeable(folder, free_bytes).await,
    })
}

/// Disk space for the home directory's file system, memory in use and the load average, now.
pub async fn read_system_usage() -> SystemUsage {
    let mut load = [0f64; 3];

    // SAFETY: `getloadavg` writes at most three samples.
    unsafe {
        libc::getloadavg(load.as_mut_ptr(), 3);
    }

    SystemUsage {
        disk: read_disk(&paths::home()).await,
        memory_used_bytes: read_memory_used().await,
        load_average: load,
        sampled_at: Utc::now(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_system_tools() {
        assert_eq!(
            parse_os_release("NAME=Ubuntu\nPRETTY_NAME=\"Ubuntu 26.04 LTS\"\n").as_deref(),
            Some("Ubuntu 26.04 LTS")
        );
        assert_eq!(
            parse_git_version("git version 2.53.0\n").as_deref(),
            Some("2.53.0")
        );
        assert_eq!(
            parse_product_name("  \"product-name\" = <\"MacBook Pro (13-inch, M1, 2020)\">"),
            Some(MachineModel {
                name: "MacBook Pro".into(),
                detail: Some("13-inch, M1, 2020".into())
            })
        );
        assert_eq!(
            parse_product_name("\"product-name\" = <\"Mac mini\">"),
            Some(MachineModel {
                name: "Mac mini".into(),
                detail: None
            })
        );
        assert_eq!(parse_hypervisor("kvm\n").as_deref(), Some("KVM"));
        assert_eq!(parse_hypervisor("none"), None);
        assert_eq!(kind_from_apple_name("Macmini9,1"), Some("mac-mini"));
        assert_eq!(
            kind_from_firmware(Some("10"), Some("LENOVO"), Some("ThinkPad")),
            Some("laptop")
        );
        assert_eq!(
            kind_from_firmware(Some("1"), Some("QEMU"), Some("Standard PC")),
            Some("cloud")
        );

        let vm_stat = "Mach Virtual Memory Statistics: (page size of 16384 bytes)\nPages free: 10.\nAnonymous pages: 100.\nPages purgeable: 10.\nPages wired down: 5.\n\"Pages occupied by compressor\": 3.\n";

        assert_eq!(parse_vm_stat(vm_stat), Some((90 + 5 + 3) * 16384));
    }

    #[test]
    fn reads_the_capacity_macos_frees_for_important_use() {
        assert_eq!(
            parse_important_capacity("48079333913\n"),
            Some(48_079_333_913)
        );
        assert_eq!(parse_important_capacity("\n"), None);
        assert_eq!(parse_important_capacity("undefined\n"), None);
    }
}
