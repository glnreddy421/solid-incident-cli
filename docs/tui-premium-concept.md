# SOLID Premium TUI Concept

## Product Concept

SOLID TUI is a terminal-native incident investigation console.

It is designed for fast cognitive orientation:

1. Understand incident context in 3-5 seconds (summary strip).
2. Investigate evidence in a guided flow (timeline -> flow -> signals -> evidence).
3. Validate reasoning (AI panel + diagnostics).
4. Execute output actions (reports/export/save).

This is intentionally not an operator dashboard; it is an investigative workspace.

## Chosen Tech Stack

- **Runtime:** Node.js + TypeScript
- **Interaction:** `readline` keypress events (cross-platform and low dependency risk)
- **Rendering:** ANSI app shell with split layout manager
- **Architecture style:** headless panel specs + shell renderer + action handlers

Why this stack:

- Fast and stable in CI/local shells.
- No heavy dependency chain for core UX iteration.
- Easy to migrate to Ink later because panels are isolated via panel spec functions.
- Keeps business logic in shared engine/contracts, not in rendering code.

## Layout System

The shell follows a focused 4-zone model:

1. **Persistent top strip**
   - title, live/batch status, trigger, confidence, services, window
2. **Primary main panel**
   - selected investigative view
3. **Secondary side context**
   - panel-specific context/actions/metadata
4. **Action footer**
   - key hints, mode/status, warning feed

This keeps hierarchy strong and avoids "8 boxes at once" clutter.

## Keybinding System

Top-level panels:

- `1` Summary
- `2` Timeline
- `3` Flow
- `4` Signals
- `5` Evidence
- `6` AI Analysis
- `7` Reports
- `8` Diagnostics

Global:

- `tab` switch main/side focus
- `/` search
- `f` filter
- `t` jump to trigger context
- `s` jump to strongest signal
- `g` refresh AI reasoning
- `r` incident report
- `c` RCA report
- `i` interview STAR story
- `e` export
- `w` save session
- `x` clear state
- `?` help overlay
- `q` quit

Live-mode specific:

- `p` pause/resume live UI updates
- `u` manual AI update
- `F` finalize stream snapshot

## Panel Specs

- **Summary:** one-screen overview + strongest signals + next actions
- **Timeline:** readable feed with trigger/anomaly markers
- **Flow:** ranked service propagation with confidence
- **Signals:** severity-first ranked signal list
- **Evidence:** searchable/filterable normalized event list
- **AI Analysis:** summary + root-cause candidates + follow-ups
- **Reports:** generation/export/save action center
- **Diagnostics:** schema + transport/debug notes

## Minimal Scaffold Modules

- `src/tui/renderer.ts` app shell loop + key handling
- `src/tui/layout.ts` layout manager
- `src/tui/panelSpecs.ts` panel registry
- `src/tui/keymap.ts` keymap model
- `src/tui/liveMode.ts` live-state model

## Mock Screens

### Batch Analysis

```text
SOLID Incident Console   BATCH   Panel 2 Timeline
Trigger: payment-service connection refused | Confidence: 91% | Services: payment-service, redis, api
Window: 14:02:11 -> 14:02:20 | Warnings: 1 | Focus: main
[1] Summary [2]*Timeline [3] Flow [4] Signals [5] Evidence [6] AI [7] Reports [8] Diagnostics
---------------------------------------------------------------------------------------------------------
-- Timeline --                                          | -- Context --
TRIGGER 14:02:12 [error] payment-service ...            | Timeline context
ANOM    14:02:15 [critical] payment-service ...         | Events: 122
       14:02:16 [warning] redis ...                     | Anomalies: 17
...                                                     | t jump trigger, s strongest signal
---------------------------------------------------------------------------------------------------------
1-8 panels ... ? help q quit
Status: Ready
```

### Live Streaming Analysis

```text
SOLID Incident Console   LIVE:incident-candidate   Panel 4 Signals
Trigger: api-gateway timeout spike | Confidence: 78% | Services: api-gateway, auth, db
Window: now-2m -> now | Warnings: 0 | Focus: side
[1] Summary [2] Timeline [3] Flow [4]*Signals [5] Evidence [6] AI [7] Reports [8] Diagnostics
---------------------------------------------------------------------------------------------------------
-- Signals --                                           | -- Context --
[critical] Timeout burst in api-gateway (12x)          | Signal context
[error] Auth retries exceeded (9x)                     | Total signals: 6
[warning] DB pool saturation trend (7x)                | Critical/Error: 3
...                                                     | p pause, u AI update, F finalize
---------------------------------------------------------------------------------------------------------
1-8 panels ... ? help q quit
Status: Live view resumed
```

### AI Analysis Panel

```text
SOLID Incident Console   BATCH   Panel 6 AI Analysis
Trigger: auth-service token validation failures | Confidence: 86% | Services: auth, gateway, redis
Window: 15:10:00 -> 15:14:20 | Warnings: 1 | Focus: main
[1] Summary [2] Timeline [3] Flow [4] Signals [5] Evidence [6]*AI [7] Reports [8] Diagnostics
---------------------------------------------------------------------------------------------------------
-- AI Analysis --                                       | -- Context --
AI Summary                                              | AI actions
Likely auth cache inconsistency after partial rollout.  | g refresh reasoning
                                                        | u manual AI update
Root cause candidates                                   |
- Token cache stale replicas                            | Recommended checks
- Redis failover lag during auth burst                  | - compare auth deployment revisions
                                                        | - verify redis role switch latency
Follow-up questions                                     |
- Did retries increase before first 5xx spike?         |
---------------------------------------------------------------------------------------------------------
Status: AI analysis refreshed
```

### Reports Panel

```text
SOLID Incident Console   BATCH   Panel 7 Reports
Trigger: payment-service startup failures | Confidence: 93% | Services: payment-service, redis
Window: 14:02:11 -> 14:02:20 | Warnings: 0 | Focus: main
[1] Summary [2] Timeline [3] Flow [4] Signals [5] Evidence [6] AI [7]*Reports [8] Diagnostics
---------------------------------------------------------------------------------------------------------
-- Reports & Actions --                                 | -- Context --
Generate                                                | Report inventory
r Incident report                                       | - Incident Report @ 2026-03-14T...
c RCA report                                            | - RCA Report @ 2026-03-14T...
i Interview STAR story                                  |
                                                        |
Export                                                  |
e export JSON/Markdown/HTML                             |
w save session snapshot                                 |
---------------------------------------------------------------------------------------------------------
Status: RCA report generated
```

## Why this is more polished for incidents

- Summary strip keeps high-value context always visible.
- Single focused panel + contextual side panel lowers cognitive load.
- Keymap is investigation-driven (trigger/signal/report actions), not infra operation.
- Calm live mode emphasizes state shifts, not log spam.
- AI-unavailable state still leaves complete investigative utility.

