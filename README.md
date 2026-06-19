# Openflow-desktop

Desktop client (macOS + Windows) using Tauri + React.

Uses the same backend sync API as web.

## Run

```bash
npm install
npm run tauri:dev
```

Set backend URL in `.env`:

```bash
VITE_API_BASE=http://localhost:8787
```

## CI + packaging + version sync

- CI workflow: `.github/workflows/ci.yml`
- Desktop build workflow: `.github/workflows/desktop-build.yml`
- Auto version sync workflow: `.github/workflows/sync-version.yml`
- Required secret to read private backend repo: `OPENFLOW_SYNC_TOKEN`
