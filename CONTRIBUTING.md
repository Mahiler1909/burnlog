# Contributing to burnlog

## Development setup

```bash
git clone https://github.com/Mahiler1909/burnlog.git
cd burnlog
npm install
```

## Running locally

```bash
npm run dev          # run CLI from source
npm run build        # compile TypeScript to dist/
npm run start        # run compiled CLI
```

## Tests

```bash
npm test             # run all tests
npm run test:watch   # watch mode
npm run test:coverage # with coverage report
```

Tests live in `test/unit/` and `test/integration/`. Add tests for any new behavior before submitting a PR.

## Commit messages

This project uses [Conventional Commits](https://www.conventionalcommits.org). The format is enforced by commitlint:

```
feat: add new command
fix: handle missing git directory
docs: update README examples
chore: bump dependencies
```

## Submitting a PR

1. Fork the repo and create a branch from `main`
2. Make your changes and add tests
3. Run `npm test` — all tests must pass
4. Open a pull request against `main`

## Releasing (maintainers only)

1. Update `version` in `package.json` and `CHANGELOG.md`
2. Commit: `chore: release vX.Y.Z`
3. Create a GitHub Release with tag `vX.Y.Z`
4. The publish workflow runs automatically and publishes to npm
