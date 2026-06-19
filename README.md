# Openflow-desktop

Desktop client (macOS + Windows) using Tauri + React.

This repo now includes a personal-use local backend with SQLite persistence.

## One-go personal run

```bash
npm run personal:start
```

This does:

1. install dependencies
2. start local backend on `http://localhost:8790`
3. launch the desktop app

SQLite DB is auto-created at:

- `./data/openflow-local.db`

## Advanced run

```bash
npm install
npm run personal:dev
```

Optional backend URL override in `.env`:

```bash
VITE_API_BASE=http://localhost:8790
```

## CI + packaging + version sync

- CI workflow: `.github/workflows/ci.yml`
- Desktop build workflow: `.github/workflows/desktop-build.yml`
- Auto version sync workflow: `.github/workflows/sync-version.yml`
- Required secret to read private backend repo: `OPENFLOW_SYNC_TOKEN`
