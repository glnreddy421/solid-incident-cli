# homebrew-solidx (tap template)

Minimal tap layout for publishing `solidx`:

```text
homebrew-solidx/
  Formula/
    solidx.rb
```

## Setup

1. Create a new repo named `homebrew-solidx`.
2. Copy `Formula/solidx.rb` from this template into the new repo.
3. Commit and push.
4. Users install with:

```bash
brew tap <your-github-user>/solidx
brew install solidx
```

## Formula updates

For each release:

1. Update `version` and all `sha256` values in `Formula/solidx.rb`.
2. Commit changes to tap repo.
3. Users run:

```bash
brew update
brew upgrade solidx
```

