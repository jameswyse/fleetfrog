#!/bin/sh
# Installs or updates the FleetFrog agent from a GitHub release:
#
#   curl -fsSL https://github.com/jameswyse/fleetfrog/releases/latest/download/install.sh | sh
#
# Set FLEETFROG_VERSION to install a particular release, such as 0.1.0, and FLEETFROG_INSTALL_DIR
# to install somewhere other than ~/.local/bin.
set -eu

# The key releases are signed with, which docs/releasing.md describes. The agent carries it too.
release_key="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGEsrE7jwC7DdJ4pIDehO+UYjB5F4GRznUVT8S4iHmse"

fail() {
  echo "fleetfrog: $1" >&2
  exit 1
}

# Downloads over HTTPS only, and refuses a redirect to anything else.
fetch() {
  curl -fsSL --proto '=https' --proto-redir '=https' -o "$1" "$2"
}

# Whether a version such as 0.5.2 or v0.5.2 names a release from before 0.5.3, the first one
# signed. Anything else, such as a version that isn't three numbers, must be signed.
predates_signing() {
  numbers=${1#v}

  case "$numbers" in
    *.*.*) ;;
    *) return 1 ;;
  esac

  major=${numbers%%.*}
  numbers=${numbers#*.}
  minor=${numbers%%.*}
  patch=${numbers#*.}

  for number in "$major" "$minor" "$patch"; do
    case "$number" in
      '' | *[!0-9]*) return 1 ;;
    esac
  done

  if [ "$major" -ne 0 ]; then
    return 1
  fi

  if [ "$minor" -ne 5 ]; then
    [ "$minor" -lt 5 ]
    return
  fi

  [ "$patch" -lt 3 ]
}

main() {
  version="${FLEETFROG_VERSION:-latest}"
  install_dir="${FLEETFROG_INSTALL_DIR:-$HOME/.local/bin}"

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

  if [ "$version" != latest ] && predates_signing "$version"; then
    signed=false
  else
    signed=true
    command -v ssh-keygen >/dev/null 2>&1 ||
      fail "needs ssh-keygen, from OpenSSH, to check the release's signature"
  fi

  mkdir -p "$install_dir"
  # Downloaded beside the installed binary, so moving it into place is a rename. A running agent
  # keeps its old copy, and macOS runs the new one instead of refusing a binary changed in place.
  # A fresh name each time, so nothing left there beforehand, such as a link, is written through.
  download=$(mktemp "$install_dir/.fleetfrog.download.XXXXXX")
  checksums=$(mktemp)
  signature=$(mktemp)
  allowed_signers=$(mktemp)
  trap 'rm -f "$download" "$checksums" "$signature" "$allowed_signers"' EXIT

  fetch "$checksums" "$downloads/SHA256SUMS"

  if [ "$signed" = true ]; then
    fetch "$signature" "$downloads/SHA256SUMS.sig" ||
      fail "couldn't download the release's signature, so its checksums can't be trusted"
    echo "releases@fleetfrog.dev $release_key" >"$allowed_signers"

    if ! ssh-keygen -Y verify -f "$allowed_signers" -I releases@fleetfrog.dev \
      -n fleetfrog-release -s "$signature" <"$checksums" >/dev/null; then
      fail "the release's signature didn't check out, so its checksums can't be trusted"
    fi
  else
    echo "FleetFrog ${version#v} predates signed releases, so its signature isn't checked."
  fi

  fetch "$download" "$downloads/$asset"

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
    echo "To connect it to your hub, open Settings › Fleet › Pair a machine in the dashboard and follow the steps there."
  fi

  case ":$PATH:" in
    *":$install_dir:"*) ;;
    *) echo "Add $install_dir to your PATH to run fleetfrog by name." ;;
  esac
}

# Everything runs from one function, so a download cut short can't run half the script.
main "$@"
