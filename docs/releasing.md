# Releasing

FleetFrog is in beta, so versions stay below 1.0. Every package shares one version, which [changesets](https://github.com/changesets/changesets) bumps.

Agents update to their hub's version and never past it, so every release ships the hub image and the agent binaries together, even when only one of them changed. `fleetfrog update` and the dashboard's update buttons download the agent from the GitHub release named after the hub's version.

To show what changed, `fleetfrog update` reads `apps/agent-rs/CHANGELOG.md` at the hub's version tag from GitHub and lists each `## <version>` section after the installed version. The dashboard links to the same file. Updates still work if the changelog moves or changes format, but `fleetfrog update` can no longer list the changes, and a move also breaks the dashboard's link.

## Versions

Describe each change people will notice in a changeset, naming the packages it changes:

```sh
pnpm changeset --patch @fleetfrog/web -m 'Centre rows in the Projects grid.'
```

Choose `minor` for a change that breaks something, such as a protocol change that needs the hub updated before the agents or a change to how the hub or agent stores data. Choose `patch` for everything else. Changesets raises every package to the highest bump among the pending changesets.

## Releasing a version

The [release workflow](../.github/workflows/release.yml) runs on every push to `main`. While changesets are pending, it keeps a pull request named "chore(release): version packages" up to date. That pull request runs [`scripts/release/version.sh`](../scripts/release/version.sh). The script runs `pnpm changeset version`, which bumps every package and writes the changes into each package's `CHANGELOG.md`. It then runs `pnpm screenshots`, so the screenshots in the README and on the website, and the website's social preview image, show the interface being released.

Merging it releases the version. The workflow then:

1. Builds the agent for Linux on x86-64 and ARM, linked statically against musl so it runs on any distribution, and for macOS on Apple silicon. It sets `FLEETFROG_RELEASE`, which marks the build as one that can update itself.
2. Builds the hub image for `linux/amd64` and `linux/arm64`.
3. Once every build passes, tags the image `ghcr.io/jameswyse/fleetfrog-hub` with the version, such as `0.1.3`, its minor version, such as `0.1`, and `latest`.
4. Signs `SHA256SUMS` with the release signing key, then creates the GitHub release and its `v0.1.3` tag, with the three agent binaries, `install.sh`, `SHA256SUMS` and its signature, `SHA256SUMS.sig`. Its notes merge the version's sections from every changelog.
5. Points the `website` branch at the release's commit, using the [release app](#setting-up-the-release-app). Workers Builds deploys [fleetfrog.dev](https://fleetfrog.dev) from that branch, so the website changes only when a version is released.

Releases are never marked as pre-releases, because `releases/latest` skips them and the install script downloads from there.

The website's download links point at `releases/latest`, so the website offers the new binaries as soon as the workflow creates the release. [`apps/site`](../apps/site/README.md) explains how it's deployed.

If a build fails, push a fix to `main` without a changeset. That push releases the same version, since it has no GitHub release yet. Rerunning the failed jobs also works when the failure was temporary.

## Checking a release

The workflow attests where each binary and the image came from. Check them with the GitHub CLI:

```sh
gh attestation verify fleetfrog-linux-x86_64 --repo jameswyse/fleetfrog
gh attestation verify oci://ghcr.io/jameswyse/fleetfrog-hub:0.1.3 --repo jameswyse/fleetfrog
```

## The signing key

Each release signs its `SHA256SUMS` with an OpenSSH ed25519 key, in the namespace `fleetfrog-release`. The install script and the agent check that signature before they trust the checksums, so someone who can replace a release's files still can't make them install another binary. Releases from before 0.5.3 aren't signed, and the install script skips the check when `FLEETFROG_VERSION` names one of them.

The private key is the repository secret `RELEASE_SIGNING_KEY`, which holds the contents of the private key file. The public key is:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGEsrE7jwC7DdJ4pIDehO+UYjB5F4GRznUVT8S4iHmse
```

It's embedded in [`install.sh`](../scripts/release/install.sh) as `release_key` and in the agent as `RELEASE_KEY` in [`apps/agent-rs/src/update/signature.rs`](../apps/agent-rs/src/update/signature.rs). The workflow checks each new signature against the copy in `install.sh`, so a wrong secret fails the release before anything is published.

Keep a backup of the private key. If it's lost, agents already installed can't check a release signed with a new key, so they can't update themselves until they're installed again with the install script that carries the new key.

To check a release by hand, download `SHA256SUMS` and `SHA256SUMS.sig` from it, then run:

```sh
echo 'releases@fleetfrog.dev ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGEsrE7jwC7DdJ4pIDehO+UYjB5F4GRznUVT8S4iHmse' > allowed_signers
ssh-keygen -Y verify -f allowed_signers -I releases@fleetfrog.dev -n fleetfrog-release -s SHA256SUMS.sig < SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
```

## Setting up the release app

A pull request opened with the workflow's own token doesn't start other workflows, so the Version packages pull request would get no CI. The workflow opens it as a GitHub App instead. The app also moves the `website` branch, which the repository's `website` ruleset lets only the app and repository admins update. To set one up:

1. [Create a GitHub App](https://github.com/settings/apps/new) owned by your account. Give it any name and homepage URL, clear **Webhook › Active**, and grant these repository permissions: **Contents** read and write, **Pull requests** read and write. Allow it to be installed only on this account.
2. On the app's page, note its **Client ID** and generate a private key.
3. Install the app on the `fleetfrog` repository only.
4. In the repository's **Settings › Secrets and variables › Actions**, add the variable `RELEASE_APP_CLIENT_ID` with the client ID, and the secret `RELEASE_APP_PRIVATE_KEY` with the contents of the private key file.
5. In the repository's **Settings › Rules › Rulesets**, add the app as a bypass actor on the `website` ruleset. Without it, releases still publish but fail to update the website.

The first push of an image creates the `fleetfrog-hub` package as private. Make it public once, under the package's **Package settings**.
