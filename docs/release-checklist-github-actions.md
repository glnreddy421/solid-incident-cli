# Release checklist (GitHub Actions + Homebrew)

Use this checklist for each `solidx` release.

## 0) Preconditions

- [ ] `package.json` version bumped.
- [ ] `solidx --version` returns the new version locally.
- [ ] Tests pass (`npm test`).
- [ ] You have a Homebrew tap repo (e.g. `homebrew-solidx`).

## 1) Create release tag

- [ ] Create and push tag:

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```

## 2) Build release artifacts (GitHub Actions)

- [ ] Run your release workflow and produce assets:
  - `solidx-vX.Y.Z-darwin-arm64.tar.gz`
  - `solidx-vX.Y.Z-darwin-x64.tar.gz`
  - `solidx-vX.Y.Z-linux-arm64.tar.gz`
  - `solidx-vX.Y.Z-linux-x64.tar.gz`
- [ ] Upload all assets to GitHub Release `vX.Y.Z`.

### Starter workflow (copy/paste)

Use workflow in this repo:

- `.github/workflows/release-solidx.yml`

## 3) Compute SHA256 checksums

- [ ] Download release assets.
- [ ] Compute checksums:

```bash
shasum -a 256 solidx-vX.Y.Z-darwin-arm64.tar.gz
shasum -a 256 solidx-vX.Y.Z-darwin-x64.tar.gz
shasum -a 256 solidx-vX.Y.Z-linux-arm64.tar.gz
shasum -a 256 solidx-vX.Y.Z-linux-x64.tar.gz
```

## 4) Update formula

- [ ] In `solid-incident-cli` repo, render formula:

```bash
VERSION=X.Y.Z \
DARWIN_ARM64_SHA256=<sha256> \
DARWIN_X64_SHA256=<sha256> \
LINUX_ARM64_SHA256=<sha256> \
LINUX_X64_SHA256=<sha256> \
./scripts/homebrew/render-formula.sh
```

- [ ] Copy updated formula to tap repo (`homebrew-solidx/Formula/solidx.rb`).
- [ ] Commit and push tap update.

## 5) Validate install

- [ ] Fresh install test:

```bash
brew tap <your-user>/solidx
brew install solidx
solidx --version
```

- [ ] Upgrade path test:

```bash
brew upgrade solidx
```

