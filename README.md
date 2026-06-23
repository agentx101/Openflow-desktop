# Openflow-desktop

Desktop client (macOS + Windows) using Tauri + React.

This repo now includes a personal-use local backend with SQLite persistence.

## One-go personal run

```bash
npm run personal:start
```

This does:

1. install dependencies
2. auto-install Rust/Cargo (first run, if missing)
3. start local backend on `http://localhost:8790`
4. launch the desktop app

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

## Billing + BYOK mode (desktop)

- Open the left sidebar `Openflow` tab and choose `Billing & API Keys`.
- `Openflow Pro` mode unlocks managed/agentic features when a Pro token is set.
- `BYOK` mode lets users run with their own provider keys (OpenAI/Anthropic/Custom Agent, ElevenLabs, Comfy).
- Settings are stored locally and served by:
- `GET /settings`
- `PUT /settings`

Optional Pro token verification hook:

- `OPENFLOW_BILLING_VERIFY_URL`
- `OPENFLOW_BILLING_VERIFY_SECRET`

## CI + packaging + version sync

- CI workflow: `.github/workflows/ci.yml`
- Desktop build workflow: `.github/workflows/desktop-build.yml`
- Auto version sync workflow: `.github/workflows/sync-version.yml`
- Required secret to read private backend repo: `OPENFLOW_SYNC_TOKEN`
