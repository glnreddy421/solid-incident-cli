# Homebrew distribution (`solidx`)

This repo includes Homebrew packaging scaffolding so users can install with:

```bash
brew install solidx
```

## What this requires

Homebrew formula expects release assets uploaded for each target:

- `solidx-v<version>-darwin-arm64.tar.gz`
- `solidx-v<version>-darwin-x64.tar.gz`
- `solidx-v<version>-linux-arm64.tar.gz`
- `solidx-v<version>-linux-x64.tar.gz`

Each tarball should contain:

- `solidx` launcher script
- `dist/` runtime files
- `package.json` (for Node ESM mode)

## Formula location

- `brew/Formula/solidx.rb`
- Tap template: `templates/homebrew-solidx/`

## Update formula for a release

1. Build and upload the 4 tarballs above to GitHub release `v<version>`.
2. Compute SHA256 checksums for each tarball.
3. Render formula:

```bash
VERSION=0.2.0 \
DARWIN_ARM64_SHA256=<sha256> \
DARWIN_X64_SHA256=<sha256> \
LINUX_ARM64_SHA256=<sha256> \
LINUX_X64_SHA256=<sha256> \
./scripts/homebrew/render-formula.sh
```

4. Commit updated formula and publish/update your Homebrew tap.

## GitHub Actions release workflow

This repo includes:

- `.github/workflows/release-solidx.yml`

It builds release assets and `checksums.txt` and uploads them to GitHub Releases on tag push.

## Notes

- This repo does not yet include binary build tooling for those tarballs.
- Formula is intentionally strict and validates with `solidx --version`.
- Release checklist + GH Actions starter: `docs/release-checklist-github-actions.md`

