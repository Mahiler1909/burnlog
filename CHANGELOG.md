# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Outcome inference from JSONL exchange patterns when facets data is unavailable
- Summary generation from first user prompt and modified files
- Session detail view with waste signals and correlated commits
- Report efficiency metrics: $/Commit and $/Line columns
- Export support (`-f json`, `-f csv`) for all commands
- `--project` option for `compare` command
- Report now uses CorrelationEngine for real commit counts
- README, CHANGELOG, LICENSE

### Fixed
- Report showing 0 commits (was reading unreliable session-meta instead of git log)
- Commit attribution to wrong project when `commitsByProject` map lacks key
- Session Activity commits count using correlated commits instead of session-meta
- HEAD branch resolution in session detail (resolves HEAD to actual branch before correlation)
- JSON export returning `0` instead of `null` for missing metrics

### Previous commits (pre-release)
- `badd948` — Robust git correlation, improved waste detection, and edge case handling
- `e638699` — Phase 2: git correlation engine, waste detection, and 3 new commands (branch, compare, waste)
- `fe26edb` — Resolve project name duplication, filter ghost sessions, merge tool_result exchanges
- `6a75fbc` — Calculate lines/files from JSONL tool calls instead of session-meta
- `25ea800` — Discover orphaned JSONL sessions and improve data coverage
- `473d99c` — Phase 1 MVP: token usage analytics CLI (report, sessions, session)
