---
name: monitor
description: "Monitor your AI coding token spend using burnlog. Use this skill proactively to check daily spend, budget status, waste patterns, and efficiency before and after working on tasks. Invoke when the user says: '/burnlog:monitor', 'how much have I spent', 'check my spend', 'check my budget', 'am I wasting tokens', 'cuanto llevo gastado', 'revisa mi gasto'."
---

# burnlog monitor

Use burnlog to monitor AI coding token spend. All commands output JSON for easy parsing.

**Requires**: `burnlog` installed (`npm install -g burnlog`) or available via `npx burnlog`.

## When to use

- **Start of session**: Check today's spend and budget status so the user knows where they stand.
- **Before a large task**: Check waste patterns to avoid known pitfalls.
- **After completing work**: Report how much the session/branch cost and its efficiency.
- **When the user asks**: Any question about spend, budget, waste, or efficiency.

**IMPORTANT**: Run burnlog commands sequentially, not in parallel. Parallel execution causes cascading failures due to shared file locks on the JSONL data store.

## Commands

### Quick daily check

```bash
npx burnlog today -f json
```

Flags: `-f`

Returns: `{ date, cost, sessions, commits, efficiencyScore, vsYesterday }`. Summarize the spend, session count, and efficiency score. Highlight the vs-yesterday comparison.

### Budget status

```bash
npx burnlog budget -f json
```

Flags: `-f`

Returns current spend vs configured limits (daily/weekly/monthly) with projections. If no budget is configured, suggest the user set one:

```bash
npx burnlog budget set --daily 25 --monthly 500
```

### Waste detection

```bash
npx burnlog waste -f json
npx burnlog waste -p 7d -f json          # last 7 days only
npx burnlog waste --project ./my-app -f json
```

Flags: `-p, --period <period>` (default 30d), `--project <path>`, `-f`

Returns waste patterns found in recent sessions with estimated wasted amount and actionable suggestions. The 9 patterns are: retry loop, debugging loop, abandoned session, context rebuild, excessive exploration, error cascade, stalled exploration, wrong approach, high cost/line.

When waste is found, relay the **suggestion** to the user — these are concrete actions to reduce spend.

### Efficiency trends

```bash
npx burnlog trends -f json
npx burnlog trends -w 8 -f json          # last 8 weeks
```

Flags: `-w, --weeks <n>` (default 4), `-f`

Returns weekly trends (cost, sessions, efficiency score) for the last N weeks. Highlight whether efficiency is improving or declining. Does NOT accept `-p/--period` — use `-w` to control the time window.

### Session deep dive

```bash
npx burnlog sessions -s cost -l 5 -f json
npx burnlog sessions -a -f json          # all sessions, no limit
npx burnlog sessions -p 42d -f json      # sessions from last 42 days
```

Flags: `-p, --period <period>`, `-s, --sort <field>` (date|cost|tokens, default date), `-l, --limit <n>` (default 20), `-a, --all` (no limit), `--project <path>`, `-f`

Returns sessions sorted by the chosen field. To drill into a specific one:

```bash
npx burnlog session <id> -f json
```

### Branch cost

```bash
npx burnlog branch <branch-name> -f json
```

Flags: `--project <path>`, `-f`

Returns cost breakdown for a branch: total cost, $/commit, $/line, session list. Useful after completing a feature to report its total cost.

Compare two branches:

```bash
npx burnlog branch <branch-a> <branch-b> -f json
```

### Full report

```bash
npx burnlog report -f json
npx burnlog report -p 90d --project ./my-app -f json
```

Flags: `-p, --period <period>` (default 30d), `--project <path>`, `-f`

Returns dashboard for the given period: spend by project, model, category, outcome, and daily breakdown.

## How to present results

- Lead with the most actionable number (today's spend, budget remaining, waste found)
- Use currency format: $X.XX
- Mention efficiency score as X/100
- If waste is detected, include the suggestion — don't just report the number
- Compare to yesterday or previous week when data is available
- Keep it concise — the user wants a quick status, not a full report

## Flags

Universal (all commands):
- `-f json` — always use this for programmatic parsing

Global option (passed before the subcommand):
- `--offline` — skip remote pricing fetch, use bundled data (`npx burnlog --offline today -f json`)

Per-command only (see each command above for which flags it accepts):
- `-p, --period <period>` — time window, e.g. `7d`, `30d`, `90d` (waste, sessions, report)
- `--project <path>` — filter by project (waste, sessions, report, branch)
- `-w, --weeks <n>` — number of weeks (trends only)
- `-s, --sort`, `-l, --limit`, `-a, --all` — sorting and pagination (sessions only)
