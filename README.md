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
git clone https://github.com/your-user/burnlog.git
cd burnlog
npm install
```

Run directly with `tsx`:

```bash
npx tsx src/index.ts report
```

Or build and run:

```bash
npm run build
node dist/index.js report
```

## Commands

### `report` — Token spend dashboard

```bash
burnlog report                          # last 30 days, all projects
burnlog report -p 7d                    # last 7 days
burnlog report --project myapp          # filter by project
burnlog report -f json                  # JSON output
```

```
Burnlog Report (Last 30 days)
════════════════════════════════════════════════════════════
Total: $199.81  |  1 sessions  |  1 projects  |  6 commits

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
  Top Waste Type:   debugging_loop ($16.11)
```

Detects patterns like:
- **retry_loop** — same tool called repeatedly with errors
- **debugging_loop** — consecutive fix attempts on the same file
- **abandoned_session** — high-cost session with no output
- **context_rebuild** — expensive cache rebuilds from long sessions
- **excessive_exploration** — too many reads with no edits
- **error_cascade** — chain of tool failures
- **stalled_exploration** — high read-to-write ratio

### `compare <branchA> <branchB>` — Compare branch efficiency

```bash
burnlog compare feat/US-402 fix/US-411 --project myapp
```

Side-by-side comparison of cost, commits, lines changed, $/commit, and waste ratio.

## Export formats

All commands support `-f, --format`:

| Format | Flag | Use case |
|--------|------|----------|
| Table | `-f table` (default) | Terminal viewing |
| JSON | `-f json` | Piping to `jq`, dashboards, automation |
| CSV | `-f csv` | Spreadsheets, data analysis |

```bash
burnlog report -f json | jq '.[] | select(.cost > 10)'
burnlog sessions --project myapp -f csv > sessions.csv
```

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
│   │   ├── report.ts
│   │   ├── sessions.ts
│   │   ├── session.ts
│   │   ├── branch.ts
│   │   ├── waste.ts
│   │   └── compare.ts
│   └── formatters/
│       ├── table.ts                  # Terminal table rendering
│       └── export.ts                 # JSON/CSV output
└── utils/
    └── pricing-tables.ts             # Model pricing data
```

## Requirements

- Node.js >= 18
- Claude Code installed (data lives in `~/.claude/`)
- Git (for commit correlation)

## License

MIT
