# solid-incident-cli

**Turn messy logs into incident timelines.**

A CLI for SRE, DevOps, and platform engineers. Analyze log files or live streams and get incident timelines, root-cause summaries, signals, impacted services, and suggested next steps.

[![npm version](https://img.shields.io/npm/v/solid-incident-cli.svg)](https://www.npmjs.com/package/solid-incident-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Features

- **Incident timelines** — Chronological, parsed events from raw logs
- **Root-cause summaries** — What likely happened with confidence scores
- **Signals / anomalies** — Repeated failures, timeouts, CrashLoop, scale-to-zero, etc.
- **Impacted services** — Inferred from log content
- **Suggested next steps** — Concrete follow-up actions
- **Optional backend** — Set `SOLID_API_URL` for AI-powered analysis and web workspace handoff

---

## Install

```bash
npm install -g solid-incident-cli
```

Or run without installing:

```bash
npx solid-incident-cli analyze logs.txt
```

From source:

```bash
git clone https://github.com/glnreddy421/solid-incident-cli.git
cd solid-incident-cli
npm install
npm run build
npm link
```

---

## Quick Start

```bash
# Analyze a log file
solid analyze logs.txt

# Analyze multiple files
solid analyze api.log worker.log redis.log db.log

# Pipe from kubectl
kubectl logs pod | solid analyze

# Generate a markdown report
solid report logs.txt --output rca.md

# Stream live logs
kubectl logs -f payment-service | solid stream
```

---

## Commands

### `solid analyze [files...]`

Analyze one or more log files (or stdin) and print a rich terminal report: timeline, signals, root cause, confidence, impacted services, and suggested next steps.

**Examples:**

```bash
solid analyze logs.txt
solid analyze api.log worker.log redis.log db.log
solid analyze ./samples/payment.log
kubectl logs pod | solid analyze
cat logs.txt | solid analyze --report json
```

**Options:**

| Option           | Description                                      |
|------------------|--------------------------------------------------|
| `--json`         | Output structured JSON                           |
| `--summary-only` | Print only summary section                       |
| `--timeline-only`| Print only timeline section                      |
| `--no-color`     | Disable color                                    |
| `--verbose`      | Include raw event details                        |
| `--open-web`     | Open analysis in web workspace (requires `SOLID_API_URL`) |
| `--since <dur>`  | Only lines from last N (e.g. `5m`, `1h`, `30s`)  |
| `--from <time>`  | Start of time window (ISO or HH:MM)              |
| `--to <time>`    | End of time window (ISO or HH:MM)                |
| `--tail <n>`     | Last N lines only                                |
| `--report [fmt]` | Generate report: `markdown`, `json`, or `text`   |

---

### `solid stream`

Read logs from **stdin** in near real time. Uses a rolling in-memory buffer, detects repeated patterns, and prints concise warnings. Nothing is written to disk.

**Example (Kubernetes):**

```bash
kubectl logs -f payment-service | solid stream
```

**Options:**

| Option            | Description                          | Default |
|-------------------|--------------------------------------|---------|
| `--window <sec>`  | Rolling analysis window (seconds)    | 30      |
| `--threshold <n>` | Repeated pattern threshold           | 3       |
| `--json`          | Emit JSON events                     | —       |
| `--quiet`         | Only print warnings/signals          | —       |
| `--open-web`      | On Ctrl+C: send buffer to API and open web (requires `SOLID_API_URL`) | — |

---

### `solid report <file>`

Generate a **markdown** or **JSON** incident report and save it to a file.

**Examples:**

```bash
solid report logs.txt
solid report logs.txt --output rca.md
solid report logs.txt --title "Payment outage 2024-03-08" --output rca.md
solid report logs.txt --json --output report.json
```

**Options:**

| Option           | Description                    | Default             |
|------------------|--------------------------------|---------------------|
| `--output <file>`| Output path                    | `incident-report.md`|
| `--title <title>`| Report title                   | Incident Report     |
| `--json`         | Generate JSON instead of MD    | —                   |

---

## Environment Variables

| Variable         | Description                                      |
|------------------|--------------------------------------------------|
| `SOLID_API_URL`  | Backend API base URL for `--open-web` and AI analysis. When set, the CLI calls the backend instead of local mock. |

Example:

```bash
export SOLID_API_URL=https://your-solid-api.example.com
solid analyze logs.txt --open-web
```

---

## Global Options

- **`-h, --help`** — Display help
- **`-V, --version`** — Display version
- **`--no-color`** — Disable colored output (all commands)

---

## Piping from Kubernetes

```bash
# Stream pod logs through SOLID
kubectl logs -f deployment/payment-service -n production | solid stream

# Save logs to file, then analyze
kubectl logs deployment/payment-service -n production --tail=5000 > pod.log
solid analyze pod.log
solid report pod.log --output payment-incident.md
```

---

## JSON Output

- **`solid analyze <file> --json`** — Prints `events`, `signals`, `summary`, `rawLineCount`
- **`solid analyze <file> --report json`** — Same as above, alternative syntax
- **`solid report <file> --json --output report.json`** — Writes JSON report to file
- **`solid stream --json`** — Emits JSON per analysis tick (signals + timestamp)

---

## Sample Logs

Included sample logs for testing:

```bash
solid analyze samples/payment.log
solid analyze samples/kubernetes-service.log
solid analyze samples/ingress-app.log
```

---

## Development

```bash
npm install
npm run typecheck   # TypeScript check
npm run build       # Compile to dist/
npm run dev         # Run with tsx (no build)
npm test            # Run tests
```

---

## Privacy

Logs are processed **ephemerally** by default. No data is sent to a server unless you set `SOLID_API_URL` and use `--open-web`. Nothing is stored to disk except reports you explicitly generate with `solid report --output <file>`.

---

## License

MIT © 2025 [glnreddy421](https://github.com/glnreddy421). See [LICENSE](LICENSE) for details.
