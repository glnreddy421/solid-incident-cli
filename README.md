# SOLID (CLI: `solidx`)

Terminal-first incident investigation for logs.

## Install

```bash
npm install -g solidx
```

Homebrew (after tap/release setup):

```bash
brew install solidx
```

Command:

```bash
solidx
```

## Quick start

```bash
# Analyze one or more log files
solidx analyze logs.txt
solidx analyze api.log worker.log db.log

# Analyze piped input
cat incident.log | solidx analyze
kubectl logs pod | solidx analyze

# Auto-detected TUI (interactive terminal)
solidx analyze logs.txt

# Live tail – TUI updates as new logs arrive
solidx analyze --live app.log

# k9s-like runtime options
solidx analyze logs.txt --inspect --interval 2 --skip-splash --log-level info

# Web UI mode (hand off to browser)
solidx analyze logs.txt --web
solidx analyze logs.txt --web --port 4000 --no-open
# In the browser: **Reports** tab → snapshot RCA / STAR — same deterministic formatter as TUI **R** / **I** and `solidx report`.
# During **--live**, those exports are **point-in-time** (provisional wording), not a final postmortem, until you press **F** (finalize) in the TUI.

# Non-TUI: attach the same snapshots to stdout/JSON/Markdown (after full pipeline: enrich + optional --follow-up)
solidx analyze logs.txt --text --heuristic-rca
solidx analyze logs.txt --json -o out.json --heuristic-rca --heuristic-interview

# Non-TUI output modes
solidx analyze logs.txt --json
solidx analyze logs.txt --md
solidx analyze logs.txt --text

# Deterministic polished report from saved JSON (RCA / STAR / CAR / executive / debug / timeline — no LLM)
solidx analyze app.log --json -o analysis.json
solidx report analysis.json --style rca
solidx report analysis.json -s star --state snapshot -o star.md
```

## Deterministic reports (no AI)

Structured **RCA**, **STAR**, **CAR**, **executive**, **debug**, and **timeline** outputs are built **only** from fields the heuristic engine already produced: a **template layer** assembles sections, then an optional **rule-based polish** pass normalizes whitespace, trims repeated phrases, and applies a few safe micro-grammar fixes. **No LLM, no remote AI, no local model** — the engine remains the source of truth; this layer does not change conclusions.

### Live tailing vs final wording

- With **`solidx analyze --live`**, each analysis includes `metadata.analysisContext.runKind: "live"`. Reports default to **provisional** language (e.g. “strongest signal so far”, “current window”) and include a **Live incident snapshot** banner plus a footer that the assessment may change as more events arrive.
- In the live TUI, **`F` (finalize)** marks the session as **`streamFinalized`**: re-analysis keeps that flag so wording can shift to **closed-analysis** phrasing where supported, without inventing new evidence.
- **Batch** runs (full file / stdin without live) typically resolve to **`final`** unless the engine reports **insufficient evidence** (then **`partial`**). Override anytime with `solidx report … --state …`.

### Examples

```bash
solidx analyze app.log --json -o analysis.json
solidx report analysis.json --style rca
solidx report analysis.json --style timeline --state live
solidx report analysis.json --style executive --no-polish   # skip cleanup pass
```

## Commands

- `solidx analyze [files...]`
- `solidx report <analysis-json>` — `-s, --style rca|star|car|executive|debug|timeline`; optional `--state`, `--no-polish`, `-o`
- `solidx enrich <analysis-json>`
- `solidx session list`
- `solidx session show <id>`
- `solidx session delete <id>`
- `solidx export <id> --json|--text|--md|--html`
- `solidx config show`
- `solidx config set <key> <value>`

## Analyze options

- `--web` — Hand off analysis to web UI on local port (default: 3456)
- `--port <number>` — Port for web UI
- `--no-open` — Do not open browser when starting web UI
- `-o, --output <path>` — Write rendered analysis output to a file
- `--no-tui`
- `--inspect`
- `--interval <seconds>`
- `--hide-header`
- `--skip-splash`
- `--log-level <error|warn|info|debug>`
- `--json` / `--text` / `--md` / `--html`
- `--save`
- `--session-name <name>`
- `--no-ai` — Disable BYO LLM (`--provider`)
- `--heuristic-rca` / `--heuristic-interview` — Non-TUI: attach engine-only RCA / STAR markdown to `result.heuristicReports` (same as TUI **R** / **I** and web **Reports**)

## AI Enrichment (Optional)

`solidx analyze` is fully local and deterministic by default. It does not require AI to run.

**One command:** pass `--provider` (and `--url` for `openai-compatible`) on **`analyze`**. Heuristics run first; the CLI then sends the same structured payload as `solidx enrich` to your endpoint. TUI/web start immediately and refresh when BYO enrichment finishes; **`--live`** re-runs BYO on a timer aligned with `--interval` (minimum ~2s between LLM calls).

**Two steps:** `solidx enrich` still takes analysis JSON if you want to re-style or re-model without re-parsing logs.

- Solid does not host your AI provider.
- Enrichment is optional.
- You bring your own endpoint/model (local or remote).
- By default, no raw logs are sent; only structured incident payload derived from local analysis output.
- **Responsibility:** If you use `openai-compatible`, you choose where data is sent and how it is handled. SOLIDX runs locally and does not operate your model service; **you are responsible for your BYO endpoint, credentials, compliance, and model output.** The CLI and UI surface an explicit notice when BYO outbound enrichment is in use. **`solidx analyze`** and **`solidx enrich`** also print the same notice to **stderr** at run start when `openai-compatible` is selected (so scripts and CI logs record it).

```bash
# BYO on analyze (Ollama)
solidx analyze logs.txt --provider openai-compatible \
  --url http://localhost:11434/v1 \
  --model llama3.1

# BYO + browser handoff
solidx analyze logs.txt --web --provider openai-compatible \
  --url https://my-gateway.example.com/v1 --api-key $API_KEY --model my-model

# Produce deterministic analysis JSON only (no LLM)
solidx analyze logs.txt --json -o analysis.json

# Re-run LLM on saved JSON without re-analyzing
solidx enrich analysis.json \
  --provider openai-compatible \
  --url http://localhost:11434/v1 \
  --model llama3.1
```

### Analyze BYO flags (with `solidx analyze`)

- `--provider <name>` — `openai-compatible` or `noop`
- `--url`, `--api-key`, `--model` — same semantics as `enrich`
- `--style`, `--enrich-timeout`, `--header`, `--temperature`, `--max-tokens`, `--system-prompt-file`, `--prompt-file` — same as `enrich` (timeout flag name is `--enrich-timeout` on analyze)
- `--follow-up <style>` — **repeatable.** After the primary BYO pass, run additional explicit styles (`briefing`, `rca`, `executive`, …). Outputs are stored in `ai.followUpArtifacts` (JSON) and in text/Markdown exports; they do **not** replace the primary narrative.

**TUI:** Panel **8 Reports** shows **RCA / STAR** after **`R`** or **`I`** — **heuristic engine only** (independent of AI / **`g`**). **`n`** + digits = BYO follow-ups. **`--heuristic-rca` / `--heuristic-interview`** fill `result.heuristicReports` before export. **`--web`:** **Reports** → Generate uses the same builder.

### Enrich flags

- `--provider <name>` required (`openai-compatible`, `noop`)
- `--url <endpoint>` endpoint/base URL (required for `openai-compatible`)
- `--api-key <key>` optional provider key
- `--model <model>` optional model
- `--style <briefing|rca|executive|runbook|star|car|debug|questions>` default **`briefing`** (interpretation / handoff prose; use **`rca`** only if you want a formal memo-style block from the LLM)
- `--timeout <ms>` optional timeout
- `--header <key:value>` repeatable custom header
- `--system-prompt-file <path>` optional system prompt override
- `--prompt-file <path>` optional user prompt override
- `--output <path>` optional output file
- `--format <json|markdown|text>` default `text`
- `--temperature <number>` optional
- `--max-tokens <number>` optional

For AI wording on analysis output, use **`solidx analyze --provider …`** or **`solidx enrich`** with your OpenAI-compatible endpoint. There is **no** separate HTTP “solid-api” dependency in this CLI.

## Development

```bash
npm install
npm run typecheck
npm run build
npm test
```

## Homebrew packaging

See `docs/homebrew.md` for formula and release workflow.
