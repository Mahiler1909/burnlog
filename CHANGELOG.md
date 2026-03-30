# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-03-30

Architecture overhaul, dynamic pricing, and CLI simplification. Same commands, better foundations.

### Added

#### Dynamic pricing
- Auto-fetch pricing from [LiteLLM](https://github.com/BerriAI/litellm) with 24-hour disk cache
- Bundled fallback pricing (`src/data/pricing.json`) for fully offline usage
- `--offline` global flag to skip remote fetch and use bundled data
- 4 new models: `opus-4-1`, `opus-4`, `sonnet-4`, `sonnet-3-7`

#### Multi-provider architecture
- `AIToolProvider` interface ready for future providers (Codex CLI, OpenCode, Amp)
- Extracted 5 focused modules from `ClaudeCodeProvider`:
  - `jsonl-parser` — JSONL → exchanges (pure parser)
  - `exchange-classifier` — tool category classification
  - `outcome-inferrer` — outcome/summary/goal heuristics
  - `path-resolver` — 5-strategy project path resolution
  - `session-builder` — facets/meta/exchanges merge

#### Testing
- 255 tests across 21 test files (up from 203)
- New unit tests for exchange classifier, outcome inferrer, and pricing fetcher
- Comprehensive coverage for waste categories, model pricing, and table renderers

### Changed
- `compare` command merged into `branch` — use `burnlog branch feat/a feat/b` for side-by-side comparison
- `today` command is now a thin alias for `report --today`
- CLI reduced from 9 commands to 7 (zero functionality lost)
- Visual primitives extracted from `table.ts` into `visual.ts` with barrel re-exports (backward compatible)
- Provider reduced from 692 LOC monolith to ~160 LOC orchestrator

### Fixed
- Opus 4.6 pricing corrected from $15/$75 to $5/$25 per million tokens (was 3x overpriced)
- Haiku 4.5 pricing corrected from $0.80/$4 to $1/$5 per million tokens (was 20% under)
- Git correlation missing commits due to branch name mismatch
- Waste category detection thresholds
- Outcome inference for edge cases
- Cost calculation data accuracy

## [0.2.1] - 2026-03-28

Visual overhaul and new high-value commands. Zero new runtime dependencies.

### Added

#### Visual Enhancements
- Unicode bar charts (`▏▎▍▌▋▊▉█`) in all percentage tables (By Model, By Category, By Outcome, By Waste Type)
- Daily cost sparkline (`▁▂▃▄▅▆▇█`) in report header with color gradient (green→yellow→red) and peak day indicator
- Efficiency Score (0–100) — composite metric combining outcome ratio, waste ratio, cost/commit, and cache hit rate
- Score gauge with red-to-green gradient via `chalk.rgb()` displayed in report header and branch detail
- Colored outcome dot indicators: `●` (achieved), `◐` (partial), `○` (failed), `◌` (unknown)
- Outcome distribution summary line above session lists: `●●●●●◐◐○ (5 OK / 2 partial / 1 fail)`
- Waste ratio bar gauge in waste report header

#### New Commands
- `burnlog today` — Quick daily summary with efficiency score, session list, and "vs Yesterday" comparison
- `burnlog budget set --daily/--weekly/--monthly` — Configure spending limits (stored in `~/.config/burnlog/config.json`)
- `burnlog budget` — Track progress against budget with visual gauge bars and monthly projection
- `burnlog trends` — Multi-week trend analysis with per-week sparklines, efficiency scores, and trend arrows (▲▼)

#### Core
- `efficiency-score.ts` — Composite scoring engine (outcome 35%, waste 25%, cost/commit 20%, cache 20%)
- `budget.ts` — Budget config persistence, spend projection, and budget-hit-date calculation

### Changed
- `renderReportHeader` now accepts `opts` object for breakdown, efficiency, and commit data
- `renderBranchDetail` accepts optional `efficiency` parameter for score display
- `renderBranchComparison` accepts optional score parameters
- Report command now computes waste signals and efficiency score
- Version bumped to 0.2.0

## [0.1.0] - 2026-03-05

First pre-release. Reads Claude Code session data from `~/.claude/` and
produces cost, waste, and efficiency reports from the terminal.

### Added

#### CLI Commands
- `burnlog report` — Token spend dashboard grouped by project, model, category, and outcome
- `burnlog sessions` — List all sessions with cost, tokens, and outcome (sort by date/cost/tokens)
- `burnlog session <id>` — Deep dive into a single session with exchange-level detail
- `burnlog branch <name>` — Cost breakdown for a feature branch with correlated git commits
- `burnlog waste` — Detect wasted token spend with actionable tips (9 waste patterns)
- `burnlog compare <a> <b>` — Side-by-side efficiency comparison between two branches

#### Core Engine
- JSONL parser: extracts exchanges, token usage, tools, files modified, and categories from Claude Code session files
- Token ledger: cost calculation using official Anthropic pricing (Opus 4.6, Sonnet 4.5, Haiku 4.5, and legacy models)
- Git correlation engine: matches sessions to commits via branch name, temporal proximity, and file overlap
- Insights engine with 9 waste detection patterns:
  - `retry_loop` — 3+ consecutive same-file edits with similar prompts
  - `abandoned_session` — not_achieved outcome, no commits, significant cost
  - `context_rebuild` — cache rebuilt after prior cache reads (context compaction)
  - `debugging_loop` — 4+ consecutive impl/debug exchanges on same files
  - `excessive_exploration` — >70% read-only exchanges with no implementation
  - `error_cascade` — 3+ consecutive debugging exchanges with tool errors
  - `high_cost_per_line` — >$1/line with >$20 cost
  - `stalled_exploration` — 3+ exploration/minimal-prompt exchanges with high cost
  - `wrong_approach` — detected from Claude Code facets friction data

#### Data & Formatting
- Exchange classification: planning, exploration, implementation, debugging (from tool usage)
- Category normalization (fix_bug -> bug_fix, documentation_* -> documentation)
- Cost breakdown by project, branch, model, category, day, and outcome
- Export support: `--format table|json|csv` on all commands
- Outcome inference from JSONL patterns when facets data is unavailable
- Ghost session filtering (empty or zero-cost sessions)
- HEAD branch resolution to actual git branch name
- Orphaned JSONL session discovery (sessions not in index)
- MCP tool name simplification in session detail (chrome:, jira:, figma:)

#### Testing
- 149 tests across 14 test files using Vitest
- 93.8% line coverage on core logic (utils, core, cli)
- Test fixtures factory for Session, Exchange, TokenUsage, GitCommit
- Unit tests for all pure functions (pricing, filters, period, token-ledger, export, formatters)
- Integration tests for correlation engine, CLI commands, and exchange classification

[0.3.0]: https://github.com/Mahiler1909/burnlog/releases/tag/v0.3.0
[0.2.1]: https://github.com/Mahiler1909/burnlog/releases/tag/v0.2.1
[0.1.0]: https://github.com/Mahiler1909/burnlog/releases/tag/v0.1.0
