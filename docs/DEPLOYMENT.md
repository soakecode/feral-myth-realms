# Deployment Guide — Feral Myth: Realms

## Overview

This game has **three independently deployed pieces**. They do not all go to the
same place — this is the single most important thing to understand before
deploying.

| Component | What it is | Recommended Platform | Notes |
|---|---|---|---|
| **Client** | Static PWA (HTML/JS/CSS built by Vite) | **Cloudflare Pages** | Free, fast CDN, great PWA support. Vercel/Netlify also fine. |
| **Game Server** | Long-lived Node.js process (Colyseus) holding in-memory room state + WebSockets | **Render** | Needs a *persistent* Node host. Railway / Fly.io / a VPS also work. |
| **Database & Auth** | PostgreSQL + Auth + RLS | **Supabase** | Free tier: 500MB DB, 50k auth users |

```
            ┌─────────────────────┐
 Browser ──▶│  Client (static PWA) │  Cloudflare Pages / Vercel / Netlify  (CDN, $0)
            └─────────┬───────────┘
                      │  wss://  (WebSocket, persistent)
                      ▼
            ┌─────────────────────┐
            │  Game Server         │  Render / Railway / Fly.io / VPS  (Node process)
            │  (Colyseus, :2567)   │
            └─────────┬───────────┘
                      │  service_role key (server-only)
                      ▼
            ┌─────────────────────┐
            │  Supabase            │  managed Postgres + Auth
            └─────────────────────┘
```

### ⚠️ Can I host everything on Cloudflare Workers?

**No — only the client.** This is the most common deployment mistake, so read this:

- ✅ The **client** is just static files. It can go on Cloudflare **Pages** (or
  Workers Static Assets). That part is fine.
- ❌ The **game server CANNOT run on Cloudflare Workers.** Workers are stateless,
  short-lived edge functions with execution-time limits. Colyseus needs the
  opposite: a **single long-running Node.js process** that keeps every room's
  state **in memory** and holds **persistent WebSocket connections** for the
  duration of each match. There is no Node process on Workers to keep that state
  alive between requests, so matchmaking and real-time sync break.

So: client on Cloudflare, **server on a real Node host** (Render/Railway/Fly.io/VPS).
The two talk over `wss://`. You point the client at the server via the
`VITE_GAME_SERVER_URL` env var.

> Self-hosting note: a single small instance handles many concurrent rooms.
> The free Render tier is enough to demo; upgrade to avoid cold starts (below).

### Prerequisite: push to GitHub first

Render and Cloudflare Pages both deploy from a Git repository. This project is
not a git repo yet, so before anything else:

```bash
cd feral-myth-realms
git init
git add .
git commit -m "Initial commit"
# create an empty repo on github.com, then:
git remote add origin https://github.com/<you>/feral-myth-realms.git
git branch -M main
git push -u origin main
```

> `.env` files are gitignored — your secrets are never pushed. You enter them in
> each platform's dashboard instead.

---

## 1. Supabase Setup

### Create Project
1. Go to [app.supabase.com](https://app.supabase.com) → **New project**
2. Choose a region close to your game server
3. Set a strong database password → **Create project**

### Get API Keys
Go to **Settings → API**:
- `Project URL` → `SUPABASE_URL`
- `anon public` key → `SUPABASE_ANON_KEY`
- `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (**server only**)

### Run Migrations
Go to **SQL Editor** → **New query** → paste and run each file in order:

```sql
-- Run 1:
-- Contents of supabase/migrations/001_initial_schema.sql

-- Run 2:
-- Contents of supabase/migrations/002_rls_policies.sql

-- Run 3 (optional):
-- Contents of supabase/migrations/003_seed_data.sql
```

### Configure Auth
Go to **Authentication → Settings**:
- Enable **Email/Password** provider
- Set **Site URL**: `https://your-frontend-domain.com`
- Add to **Redirect URLs**: `https://your-frontend-domain.com`

### Verify Tables
Go to **Table Editor** — you should see:
- `profiles`
- `characters`
- `player_stats`
- `match_history`
- `friend_codes`

### Verify RLS
Go to each table → **Policies** → confirm policies are listed.

### Test Auth
Go to **Authentication → Users** → **Invite user** → verify profile row is auto-created.

---

## 2. Frontend — Cloudflare Pages

### Why Cloudflare Pages
- Global CDN with zero-config
- Free tier with unlimited requests
- Excellent PWA support (service workers allowed on all paths)
- Automatic HTTPS

### Deploy Steps

1. Push your code to GitHub
2. Go to [pages.cloudflare.com](https://pages.cloudflare.com) → **Create application → Pages → Connect Git**
3. Select your repository
4. Configure build settings:
   - **Build command**: `npm run build:client`
   - **Build output directory**: `apps/client/dist`
   - **Root directory**: `/` (monorepo root)
5. Add environment variables:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_GAME_SERVER_URL=wss://your-server.onrender.com
   ```
6. Deploy

### Verify PWA
After deploying, open the site in Chrome:
- Lighthouse Audit → PWA category should pass
- Address bar should show install icon
- Check **Application → Service Workers** in DevTools

### Alternative: Vercel
```bash
npm i -g vercel
cd feral-myth-realms
vercel --build-env VITE_SUPABASE_URL=... --build-env VITE_GAME_SERVER_URL=...
```
Set **Output directory**: `apps/client/dist`  
Set **Build command**: `npm run build:client`

---

## 3. Game Server — Render

### Why Render
- Free tier with persistent Node.js processes
- Native WebSocket support (critical for Colyseus)
- Auto-deploys from GitHub
- Free TLS

> ⚠️ **Free tier on Render sleeps after 15 minutes of inactivity.** The first connection after sleep takes ~30s. Use the paid tier ($7/mo) or Railway/Fly.io for production.

### How the server build works (monorepo + esbuild)

The server imports `@fmr/shared`, a workspace package that ships TypeScript
source (no separate build). `npm run build:server` runs **esbuild**
(`apps/server/esbuild.mjs`), which **inlines `@fmr/shared` into a single
self-contained `apps/server/dist/index.js`** and leaves the real npm
dependencies external. `npm start` then runs `node dist/index.js`.

> Because of the workspace, the build must run from the **monorepo root** (so npm
> can resolve `@fmr/shared`), **not** from `apps/server`. This is why the Render
> config below uses the repo root as the root directory — a common gotcha.

### Option A — One-click Blueprint (recommended)

This repo ships a [`render.yaml`](../render.yaml) Blueprint:

1. Push code to GitHub (see prerequisite above).
2. On [render.com](https://render.com) → **New + → Blueprint** → select your repo.
3. Render reads `render.yaml` and creates the `fmr-server` web service.
4. Fill in the secret env vars in the dashboard (they are marked `sync: false`):
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_ORIGIN`.
5. Deploy.

### Option B — Manual Web Service

1. Push code to GitHub.
2. Go to [render.com](https://render.com) → **New → Web Service** → connect your repo.
3. Configure:
   - **Name**: `fmr-server`
   - **Root Directory**: *(leave blank — use the repo root)*
   - **Runtime**: `Node`
   - **Build Command**: `npm install && npm run build:server`
   - **Start Command**: `npm start --workspace=apps/server`
   - **Health Check Path**: `/health`
   - **Instance Type**: Free (or Starter for no sleep)
4. Add environment variables:
   ```
   NODE_ENV=production
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   CLIENT_ORIGIN=https://your-frontend.pages.dev
   ```
   > Do **not** set `PORT` — Render injects it automatically and the server reads
   > `process.env.PORT`.
5. Deploy.

### Verify Server is Online
```bash
curl https://your-server.onrender.com/health
# Expected: {"status":"ok","timestamp":...}
```

### Alternative: Railway
Run from the **repo root**. Railway auto-detects the `Dockerfile`, or uses Nixpacks:
```bash
npm i -g @railway/cli
railway login
railway init
railway up                      # builds from repo root (Dockerfile or Nixpacks)
railway variables set NODE_ENV=production \
  SUPABASE_URL=... SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... CLIENT_ORIGIN=https://your-frontend.pages.dev
```

### Alternative: Fly.io (uses the included Dockerfile)
Run from the **repo root** — the [`Dockerfile`](../Dockerfile) bundles the server:
```bash
fly launch --name fmr-server --no-deploy   # generates fly.toml; keep internal_port = 2567
fly secrets set SUPABASE_URL=... SUPABASE_ANON_KEY=... \
  SUPABASE_SERVICE_ROLE_KEY=... CLIENT_ORIGIN=https://your-frontend.pages.dev
fly deploy
```

### Alternative: Docker / VPS (self-host)
```bash
# from the repo root
docker build -t fmr-server .
docker run -d -p 2567:2567 \
  -e NODE_ENV=production \
  -e SUPABASE_URL=... -e SUPABASE_ANON_KEY=... \
  -e SUPABASE_SERVICE_ROLE_KEY=... \
  -e CLIENT_ORIGIN=https://your-frontend.pages.dev \
  fmr-server
```
Put Nginx/Caddy in front for TLS so the client can reach it over `wss://`.

---

## 4. Environment Variables Reference

### Client (Vite — prefix VITE_ required)

| Variable | Example | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | `https://abc.supabase.co` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon/public key |
| `VITE_GAME_SERVER_URL` | `wss://fmr-server.onrender.com` | Colyseus WebSocket URL |

### Server (Node.js — no VITE_ prefix)

| Variable | Example | Description |
|---|---|---|
| `PORT` | `2567` | Server listen port |
| `NODE_ENV` | `production` | Environment flag |
| `SUPABASE_URL` | `https://abc.supabase.co` | Supabase project URL |
| `SUPABASE_ANON_KEY` | `eyJ...` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | **NEVER expose to client** |
| `CLIENT_ORIGIN` | `https://your-site.pages.dev` | CORS allowed origin |

---

## 5. Production Checklist

- [ ] Supabase project created with proper region
- [ ] All 3 SQL migrations executed in order
- [ ] RLS enabled and policies verified on all tables
- [ ] Auth email/password enabled
- [ ] `SUPABASE_SERVICE_ROLE_KEY` only in server env vars
- [ ] `CLIENT_ORIGIN` set to actual frontend domain
- [ ] `VITE_GAME_SERVER_URL` uses `wss://` (not `ws://`) in production
- [ ] Frontend deployed and accessible via HTTPS
- [ ] Server health endpoint responds: `GET /health`
- [ ] Colyseus monitor disabled in production (`NODE_ENV=production`)
- [ ] PWA installs correctly on mobile Chrome
- [ ] Two-player test from different devices completed
- [ ] Icons generated: `apps/client/public/icons/icon-192.png` and `icon-512.png`

---

## Service Worker and Multiplayer

> ⚠️ The PWA service worker handles **static asset caching only**. It does NOT intercept or proxy WebSocket connections to the game server. The Colyseus WebSocket connection is made directly from the client to the server. Offline mode does not support multiplayer gameplay.

---

## Common Issues

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for solutions to frequent deployment problems.
