# burnlog

**Know where your AI coding tokens go. Stop the bleeding.**

[![npm version](https://img.shields.io/npm/v/burnlog)](https://www.npmjs.com/package/burnlog)
[![npm downloads](https://img.shields.io/npm/dm/burnlog)](https://www.npmjs.com/package/burnlog)
[![license](https://img.shields.io/npm/l/burnlog)](./LICENSE)
[![node](https://img.shields.io/node/v/burnlog)](https://nodejs.org)
[![CI](https://github.com/Mahiler1909/burnlog/actions/workflows/ci.yml/badge.svg)](https://github.com/Mahiler1909/burnlog/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/Mahiler1909/burnlog/graph/badge.svg)](https://codecov.io/gh/Mahiler1909/burnlog)

<!-- TODO: replace with asciinema/vhs recording -->
```
$ burnlog today

  Today's Burn                           vs Yesterday
  ═══════════════════════════════════════════════════════
  Spent:     $18.40  (4 sessions)        ▼ $6.20 less
  Commits:   7                           ▲ 3 more
  Efficiency: 74/100 ████████████░░░░░░  ▲ +12 points
  Top Waste:  Retry loop on auth.ts      -$3.20

$ burnlog waste

  Waste Report (Last 30 days)
  ═══════════════════════════════════════════════════════
  Total Spend:      $200.00
  Estimated Waste:  $17.40 (8.7%)
  Top Waste Type:   Debugging Loop ($16.11)

  ┌──────────────────┬──────────┬────────────────────────────────┐
  │ Pattern          │ Wasted   │ Suggestion                     │
  ├──────────────────┼──────────┼────────────────────────────────┤
  │ Debugging Loop   │ $16.11   │ Break the loop: write a test   │
  │ Context Rebuild  │ $1.29    │ Keep sessions under 45 min     │
  └──────────────────┴──────────┴────────────────────────────────┘
```

## The problem

AI coding sessions can cost $5-$200+. You have no idea where that goes. burnlog reads the data your AI coding assistant already stores and cross-references it with `git log` to answer:

- Which project eats the most budget?
- Did that $50 session actually produce commits?
- Am I stuck in retry loops burning tokens for nothing?
- What's my efficiency trend this week vs last?

## Supported providers

burnlog currently supports **Claude Code** (reads from `~/.claude/`). The architecture is designed to support additional AI coding assistants in the future:

- **Claude Code** — fully supported
- **Codex CLI** — planned
- **OpenCode** — planned
- **Amp** — planned

## Try it now

```bash
npx burnlog
```

That's it. No config, no setup. If you've used Claude Code, you already have data.

## Install

```bash
npm install -g burnlog
```

## Commands

### Daily workflow

| Command | What it does |
|---------|-------------|
| `burnlog today` | Quick daily summary with vs-yesterday comparison and efficiency score |
| `burnlog budget` | Track spending against daily/weekly/monthly limits with projections |
| `burnlog budget set --daily 25 --monthly 500` | Configure your budget limits |
| `burnlog trends` | 4-week trend analysis with sparklines and efficiency scores |

### Analysis

| Command | What it does |
|---------|-------------|
| `burnlog` | Token spend dashboard — last 30 days, broken down by project/model/outcome |
| `burnlog sessions -s cost -l 10` | Top 10 most expensive sessions |
| `burnlog session <id>` | Deep dive: exchange log, waste signals, correlated commits |
| `burnlog waste` | Detect wasted spend with actionable suggestions |
| `burnlog branch feat/US-402` | Cost breakdown for a feature branch ($/commit, $/line) |
| `burnlog branch feat/US-402 fix/US-411` | Side-by-side efficiency comparison between two branches |

All commands support `--period` (7d, 30d, 90d), `--project`, `-f json|csv|table`, and `--offline`.

## Dynamic pricing

burnlog fetches up-to-date model pricing from [LiteLLM](https://github.com/BerriAI/litellm) automatically and caches it for 24 hours. This means new models and price changes are picked up without updating burnlog itself.

```bash
burnlog report              # auto-fetches pricing if cache expired
burnlog report --offline    # uses bundled pricing (no network)
```

## What it detects

burnlog identifies 9 waste patterns and tells you how to fix them:

| Pattern | What's happening | Suggestion |
|---------|-----------------|------------|
| **Retry Loop** | 3+ consecutive same-file edits with similar prompts | Break the loop — describe what's wrong differently |
| **Debugging Loop** | 4+ consecutive fix attempts on the same files | Write a failing test first, then let Claude fix it |
| **Abandoned Session** | High-cost session with no commits | Start smaller — break the task into pieces |
| **Context Rebuild** | Expensive cache rebuilds mid-session | Keep sessions under 45 min to avoid context rot |
| **Excessive Exploration** | 70%+ read-only exchanges, no edits | Be specific about what you want changed |
| **Error Cascade** | Chain of consecutive tool failures | Check errors early — don't let Claude spiral |
| **Stalled Exploration** | Repeated "continue" prompts with no progress | Redirect with a concrete next step |
| **Wrong Approach** | Approach needed to be rethought mid-session | Spend 2 min planning before starting a session |
| **High Cost/Line** | >$1/line on expensive sessions | Check if generated code was actually needed |

## Efficiency score

Each session and period gets a **0-100 efficiency score** combining:

| Component | Weight | What it measures |
|-----------|--------|-----------------|
| Outcome | 35% | Did the session achieve its goal? |
| Waste ratio | 25% | What % of spend was wasted? |
| Cost efficiency | 20% | $/commit — lower is better |
| Cache hit rate | 20% | How well prompts reused context? |

## Reading the numbers

### $/Commit

| Range | Meaning |
|-------|---------|
| < $5 | Very efficient — quick, focused changes |
| $5-$15 | Normal — typical feature work |
| $15-$30 | Expensive — complex tasks or back-and-forth |
| > $30 | Investigate — possible retry loops |

### Waste ratio

| Range | Meaning |
|-------|---------|
| < 10% | Good — minimal waste |
| 10-25% | Normal — some inefficiency is expected |
| > 25% | High — check `burnlog waste` for tips |

## Export & automation

```bash
# Pipe to jq for custom queries
burnlog report -f json | jq '.byProject[] | select(.cost > 10)'

# Export to CSV for spreadsheets
burnlog sessions -f csv > sessions.csv

# Daily spend check in your shell profile
alias burn="npx burnlog today"
```

## How it works

burnlog reads from `~/.claude/projects/` (session indexes, JSONL conversation logs, facets, and session metadata). It correlates sessions to git commits using a 3-tier strategy:

1. **Branch match** — session branch = commit branch (highest confidence)
2. **Temporal match** — commit within session time window (±2 hours)
3. **File overlap** — modified files in session overlap with commit diffs

No data leaves your machine. Everything is local, read-only.

## Requirements

- Node.js >= 18
- Claude Code installed (data in `~/.claude/`)
- Git (for commit correlation — optional)

## License

MIT
