# burnlog

Correlate AI coding assistant token usage with real development work. Reads Claude Code's internal data files (`~/.claude/`) and git history to answer: **where did my tokens go and was it worth it?**

## Why

Claude Code sessions can burn through tokens fast. Without visibility, you're flying blind:

- Which project eats the most budget?
- Did that $50 session actually produce commits?
- Am I wasting tokens on retry loops and abandoned sessions?

burnlog reads the raw data Claude Code already stores and cross-references it with `git log` to give you hard numbers.

## Install

```bash
# From npm
npm install -g burnlog

# Or run without installing
npx burnlog
```

From source:

```bash
git clone https://github.com/fernandochullo/burnlog.git
cd burnlog
npm install
npm run build
npm link    # makes 'burnlog' available globally
```

## Quick start

```bash
burnlog                    # shows token spend dashboard (last 30 days)
burnlog sessions -s cost   # list sessions sorted by cost
burnlog waste              # detect wasted token spend
```

## Commands

### `report` — Token spend dashboard (default)

```bash
burnlog report                          # last 30 days, all projects
burnlog report -p 7d                    # last 7 days
burnlog report --project myapp          # filter by project
burnlog report -f json                  # JSON output (includes all breakdowns)
```

```
Burnlog Report (Last 30 days)
════════════════════════════════════════════════════════════
Total: $199.81  |  12 sessions  |  3 projects  |  6 commits

By Project
┌─────────┬─────────┬──────────┬─────────┬────────────┬──────────┬────────┬─────────┐
│ Project │ Cost    │ Sessions │ Commits │ Lines +/-  │ $/Commit │ $/Line │ Outcome │
└─────────┴─────────┴──────────┴─────────┴────────────┴──────────┴────────┴─────────┘
```

Includes breakdowns by model, goal category, and outcome.

### `sessions` — List all sessions

```bash
burnlog sessions --project myapp
burnlog sessions -s cost -l 10          # top 10 by cost
burnlog sessions -p 7d                  # last 7 days only
burnlog sessions --all                  # show all (no limit)
burnlog sessions -f csv                 # CSV export
```

Shows each session with ID, date, project, branch, cost, token count, outcome, and summary.

### `session <id>` — Deep dive into a single session

```bash
burnlog session 3dc22f18                # prefix match works
burnlog session 3dc22f18 -f json
```

Shows full session detail including:
- Token usage breakdown (input, output, cache)
- Activity stats (lines, files, commits)
- Exchange-level log (each prompt/response with cost, model, tools used)
- Waste signals detected in the session
- Correlated git commits

### `branch <name>` — Cost breakdown for a feature branch

```bash
burnlog branch feat/US-402
burnlog branch main --project myapp
```

Correlates sessions with git commits on the branch. Shows total cost, $/commit, $/line changed, and waste ratio.

### `waste` — Detect wasted token spend

```bash
burnlog waste                           # last 30 days
burnlog waste -p 7d --project myapp
```

```
Burnlog Waste Report (Last 30 days)
════════════════════════════════════════════════════════════
  Total Spend:      $200.00
  Estimated Waste:  $17.40 (8.7%)
  Top Waste Type:   Debugging Loop ($16.11)
```

Detects patterns like:
- **Retry Loop** — same tool called repeatedly with errors
- **Debugging Loop** — consecutive fix attempts on the same file
- **Abandoned Session** — high-cost session with no output
- **Context Rebuild** — expensive cache rebuilds from long sessions
- **Excessive Exploration** — too many reads with no edits
- **Error Cascade** — chain of tool failures
- **Stalled Exploration** — high read-to-write ratio
- **Wrong Approach** — approach that needed to be rethought

### `compare <branchA> <branchB>` — Compare branch efficiency

```bash
burnlog compare feat/US-402 fix/US-411 --project myapp
```

Side-by-side comparison of cost, commits, lines changed, $/commit, and waste ratio. Use `--project` when you have multiple projects with the same branch names.

## Export formats

All commands support `-f, --format`:

| Format | Flag | Use case |
|--------|------|----------|
| Table | `-f table` (default) | Terminal viewing |
| JSON | `-f json` | Piping to `jq`, dashboards, automation |
| CSV | `-f csv` | Spreadsheets, data analysis |

```bash
burnlog report -f json | jq '.byProject[] | select(.cost > 10)'
burnlog sessions --project myapp -f csv > sessions.csv
```

## Reading the numbers

### $/Commit

How much each git commit cost in tokens. Lower is more efficient.

| Range | Interpretation |
|-------|---------------|
| < $5 | Very efficient — quick, focused changes |
| $5–$15 | Normal — typical feature work |
| $15–$30 | Expensive — complex tasks or some back-and-forth |
| > $30 | Investigate — possible retry loops or overexploration |

### $/Line

Cost per line of code changed (added + removed). Context-dependent — a 1-line bug fix may cost more per line than scaffolding 500 lines.

### Waste ratio

Percentage of session cost attributed to detected waste patterns.

| Range | Interpretation |
|-------|---------------|
| < 10% | Good — minimal waste |
| 10–25% | Normal — some inefficiency is expected |
| > 25% | High — review waste signals for actionable tips |

### Outcome

How well the session achieved its goal:

| Value | Meaning |
|-------|---------|
| `fully_achieved` | Task completed successfully |
| `mostly_achieved` | Task completed with minor gaps |
| `partially_achieved` | Some progress but incomplete |
| `not_achieved` | Task not completed |
| `unknown` | Short or planning-only sessions |

## How it works

### Data sources

burnlog reads from `~/.claude/projects/`:

| Source | What it provides |
|--------|-----------------|
| `sessions-index.json` | Session list with IDs, paths, branches |
| JSONL conversations | Token usage per exchange, tools used, files modified |
| `usage-data/facets/*.json` | Goals, outcomes, satisfaction (when available) |
| `usage-data/session-meta/*.json` | Aggregated stats per session |

### Git correlation

Sessions are matched to git commits using a 3-tier strategy:

1. **Branch name match** — session's branch matches commit's branch (highest confidence)
2. **Temporal match** — commit timestamp falls within session start/end +2 hours
3. **File overlap** — basename overlap between session's modified files and commit's changed files

### Outcome inference

When Claude Code's facets data isn't available, burnlog infers outcomes from exchange patterns:

- **fully_achieved** — has implementation exchanges, produced changes, no errors
- **partially_achieved** — produced changes but had errors or interruptions
- **not_achieved** — many exchanges but no implementation, or errors with no output
- **unknown** — short or planning-only sessions

## Troubleshooting

### "No sessions found"

- burnlog reads data from `~/.claude/`. Make sure you've used Claude Code at least once.
- Check your `--period` filter — the default is 30 days. Use `-p 90d` for a wider window.
- Check your `--project` filter — it matches project names and paths (case-insensitive, partial match).

### Git repo not found

- burnlog resolves git repos from the project paths stored in `~/.claude/`. If a project directory was moved or deleted, git correlation won't work for that project.
- Git correlation is optional — token and cost data still shows without git.

### Empty token counts

- Older Claude Code versions may not log detailed usage data. burnlog falls back to session-meta when JSONL data is incomplete.

## Architecture

```
src/
├── index.ts                          # CLI entry (commander.js)
├── data/models.ts                    # TypeScript interfaces
├── providers/
│   ├── provider.interface.ts         # Provider contract
│   └── claude-code/provider.ts       # Reads ~/.claude/ data files
├── core/
│   ├── token-ledger.ts               # Token counting and cost calculation
│   ├── correlation-engine.ts         # Git ↔ session matching
│   └── insights-engine.ts            # Waste pattern detection
├── git/
│   └── git-analyzer.ts               # Git log, branch, diff operations
├── cli/
│   ├── commands/                     # One file per command
│   └── formatters/
│       ├── table.ts                  # Terminal table rendering
│       └── export.ts                 # JSON/CSV output
└── utils/
    ├── pricing-tables.ts             # Model pricing data
    ├── period.ts                     # Time period parsing
    └── filters.ts                    # Shared session filters
```

## Requirements

- Node.js >= 18
- Claude Code installed (data lives in `~/.claude/`)
- Git (for commit correlation)

## License

MIT
