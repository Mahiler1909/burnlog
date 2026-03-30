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

## Commands

### Quick daily check

```bash
npx burnlog today -f json
```

Returns: `{ date, cost, sessions, commits, efficiencyScore, vsYesterday }`. Summarize the spend, session count, and efficiency score. Highlight the vs-yesterday comparison.

### Budget status

```bash
npx burnlog budget -f json
```

Returns current spend vs configured limits (daily/weekly/monthly) with projections. If no budget is configured, suggest the user set one:

```bash
npx burnlog budget set --daily 25 --monthly 500
```

### Waste detection

```bash
npx burnlog waste -f json
```

Returns waste patterns found in recent sessions with estimated wasted amount and actionable suggestions. The 9 patterns are: retry loop, debugging loop, abandoned session, context rebuild, excessive exploration, error cascade, stalled exploration, wrong approach, high cost/line.

When waste is found, relay the **suggestion** to the user — these are concrete actions to reduce spend.

### Efficiency trends

```bash
npx burnlog trends -f json
```

Returns weekly trends (cost, sessions, efficiency score) for the last 4 weeks. Highlight whether efficiency is improving or declining.

### Session deep dive

```bash
npx burnlog sessions -s cost -l 5 -f json
```

Returns the 5 most expensive sessions. To drill into a specific one:

```bash
npx burnlog session <id> -f json
```

### Branch cost

```bash
npx burnlog branch <branch-name> -f json
```

Returns cost breakdown for a branch: total cost, $/commit, $/line, session list. Useful after completing a feature to report its total cost.

Compare two branches:

```bash
npx burnlog branch <branch-a> <branch-b> -f json
```

### Full report

```bash
npx burnlog report -f json
```

Returns 30-day dashboard: spend by project, model, category, outcome, and daily breakdown.

## How to present results

- Lead with the most actionable number (today's spend, budget remaining, waste found)
- Use currency format: $X.XX
- Mention efficiency score as X/100
- If waste is detected, include the suggestion — don't just report the number
- Compare to yesterday or previous week when data is available
- Keep it concise — the user wants a quick status, not a full report

## Flags

All commands support:
- `-f json` — always use this for programmatic parsing
- `-p, --period <period>` — time window: `7d`, `30d`, `90d`
- `--project <path>` — filter by project
- `--offline` — skip remote pricing fetch, use bundled data
