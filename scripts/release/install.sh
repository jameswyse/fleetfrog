#!/bin/sh
# Installs or updates the FleetFrog agent from a GitHub release:
#
#   curl -fsSL https://github.com/jameswyse/fleetfrog/releases/latest/download/install.sh | sh
#
# Set FLEETFROG_VERSION to install a particular release, such as 0.1.0, and FLEETFROG_INSTALL_DIR
# to install somewhere other than ~/.local/bin.
set -eu

version="${FLEETFROG_VERSION:-latest}"
install_dir="${FLEETFROG_INSTALL_DIR:-$HOME/.local/bin}"

fail() {
  echo "fleetfrog: $1" >&2
  exit 1
}

case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=macos ;;
  *) fail "there is no agent build for $(uname -s)" ;;
esac

case "$(uname -m)" in
  x86_64 | amd64) arch=x86_64 ;;
  aarch64 | arm64) arch=aarch64 ;;
  *) fail "there is no agent build for $(uname -m)" ;;
esac

asset="fleetfrog-$os-$arch"

case "$asset" in
  fleetfrog-macos-x86_64) fail "there is no agent build for Intel Macs" ;;
esac

if [ "$version" = latest ]; then
  downloads="https://github.com/jameswyse/fleetfrog/releases/latest/download"
else
  downloads="https://github.com/jameswyse/fleetfrog/releases/download/v${version#v}"
fi

mkdir -p "$install_dir"
# Downloaded beside the installed binary, so moving it into place is a rename. A running agent
# keeps its old copy, and macOS runs the new one instead of refusing a binary changed in place.
download="$install_dir/.fleetfrog.download"
checksums=$(mktemp)
trap 'rm -f "$download" "$checksums"' EXIT

curl -fsSL -o "$download" "$downloads/$asset"
curl -fsSL -o "$checksums" "$downloads/SHA256SUMS"

expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$checksums")

if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$download" | cut -d " " -f 1)
else
  actual=$(shasum -a 256 "$download" | cut -d " " -f 1)
fi

if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
  fail "the download doesn't match the release's checksum"
fi

chmod 755 "$download"
mv -f "$download" "$install_dir/fleetfrog"
echo "Installed the FleetFrog agent $("$install_dir/fleetfrog" --version) at $install_dir/fleetfrog."

# A service runs the binary it was installed from. Installing it again from this one moves an
# existing service here and restarts it on the new version.
if [ -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/fleetfrog.service" ] ||
  [ -f "$HOME/Library/LaunchAgents/net.fleetfrog.agent.plist" ]; then
  "$install_dir/fleetfrog" service install
else
  echo "To connect it to your hub, open Machines in the dashboard, choose Pair a machine and run the commands it shows."
fi

case ":$PATH:" in
  *":$install_dir:"*) ;;
  *) echo "Add $install_dir to your PATH to run fleetfrog by name." ;;
esac
