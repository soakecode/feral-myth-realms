# Troubleshooting — Feral Myth: Realms

## CORS Error (browser console)

**Symptom**: `Access-Control-Allow-Origin` error when connecting to server.

**Fix**:
```env
# apps/server/.env
CLIENT_ORIGIN=http://localhost:5173   # dev
CLIENT_ORIGIN=https://your-site.pages.dev  # production
```
Make sure the value matches the *exact* origin (no trailing slash).

---

## WebSocket won't connect

**Symptom**: `colyseus.js` shows connection refused or timeout.

**Checklist**:
1. Is the server running? `npm run dev:server` — check for errors
2. Does `http://localhost:2567/health` respond?
3. Check `VITE_GAME_SERVER_URL` in `.env`:
   - Dev: `ws://localhost:2567`
   - Production: `wss://your-server.onrender.com` (must use wss://)
4. On mobile (same network): use `ws://YOUR_LAN_IP:2567`
5. Firewall: ensure port 2567 is open locally

---

## Supabase Auth fails

**Symptom**: Sign-in returns error, or user row not created.

**Checklist**:
1. Verify `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are correct
2. Check Supabase Dashboard → Auth → **Email** provider is enabled
3. Check **Site URL** in Supabase Auth settings matches your domain
4. If using email confirmation: verify the email before testing sign-in
5. Check browser console for specific Supabase error messages
6. Test with Supabase Dashboard → SQL Editor:
   ```sql
   SELECT * FROM auth.users LIMIT 5;
   SELECT * FROM profiles LIMIT 5;
   ```
7. If profiles table is empty after signup: check the `handle_new_user` trigger:
   ```sql
   SELECT * FROM pg_trigger WHERE tgname = 'on_auth_user_created';
   ```

---

## Environment variables not working

**Symptom**: `VITE_SUPABASE_URL` is undefined in browser.

**Fix**:
- All client vars **must** start with `VITE_`
- The `.env` file must be in the **project root** (`feral-myth-realms/.env`)
- Restart `npm run dev:client` after changing `.env`
- In production (Cloudflare Pages/Vercel), set vars in the platform dashboard

---

## PWA won't install

**Symptom**: No install prompt, or service worker errors.

**Checklist**:
1. Must be served over **HTTPS** (or `localhost`)
2. Icons must exist: `apps/client/public/icons/icon-192.png` and `icon-512.png`
   - Generate them: `node apps/client/scripts/gen-png-icons.cjs`
3. `manifest.webmanifest` must be accessible at root
4. Open Chrome DevTools → **Application → Manifest** — check for errors
5. Check **Application → Service Workers** for registration errors
6. Clear service worker cache: DevTools → Application → Service Workers → **Unregister**

---

## Build fails

**Symptom**: `npm run build` returns TypeScript or Vite errors.

**Fix**:
```bash
# Check TypeScript errors specifically
npm run typecheck

# Common causes:
# 1. Missing @fmr/shared types — ensure packages/shared is built first
npm run build --workspace=packages/shared

# 2. Colyseus schema decorators
# The @type() decorators require reflect-metadata in some configs.
# If you see decorator errors, check tsconfig.json experimentalDecorators setting.

# 3. Missing .env file — Vite needs it even for build
cp .env.example .env
```

---

## Room won't synchronize / players don't see each other

**Symptom**: Two browser tabs show game but players are in different rooms.

**Fix**:
- Both players must be in the same **room ID**
- Use "Unirse a sala cooperativa" (join or create — finds existing room)
- Or use the room code: one player creates, the other uses the code
- Check server logs: `npm run dev:server` — look for `[RealmRoom] joined`
- Check the Colyseus monitor: `http://localhost:2567/colyseus`

---

## Render / Railway server sleeps

**Symptom**: First connection after inactivity takes 20–30 seconds, WebSocket timeout.

**Fix**:
- Render free tier sleeps after 15 minutes of no HTTP traffic
- Option 1: Upgrade to Render Starter ($7/mo) — no sleep
- Option 2: Use an uptime monitor (UptimeRobot) to ping `/health` every 10 minutes
- Option 3: Migrate to Railway (free tier has always-on options)
- Option 4: Fly.io with `min_machines_running = 1`

---

## Colyseus version conflicts

**Symptom**: `@colyseus/core` import errors or room not found.

**Fix**:
Ensure all Colyseus packages are on the same version:
```bash
# Check versions
npm ls @colyseus/core @colyseus/sdk --all

# If mismatched, update:
npm install @colyseus/core@^0.15.17 --workspace=apps/server
npm install @colyseus/sdk@^0.15.17 --workspace=apps/client
```

---

## `colyseus.js` vs `@colyseus/sdk`

**Note**: The client uses `colyseus.js` (browser bundle) via the `@colyseus/sdk` package. The import path is:
```typescript
import { Client, Room } from 'colyseus.js';  // correct for browser
```
Not `from '@colyseus/core'` (that is server-only).

---

## Enemy AI not working / enemies frozen

**Symptom**: Enemies spawn but don't move.

**Fix**:
- Enemies are controlled by the server — check `npm run dev:server` logs
- The `EnemyAI.tick()` runs every 50ms (TICK_MS)
- Verify `setSimulationInterval` is called in `RealmRoom.onCreate()`
- If `TICK_MS` is 0, the interval won't fire — check `packages/shared/src/constants/index.ts`

---

## Stats not saving after match

**Symptom**: Match ends but `player_stats` not updated in Supabase.

**Fix**:
1. Server must have `SUPABASE_SERVICE_ROLE_KEY` set (not just anon key)
2. Player must be **registered** (not guest) — guests have no userId
3. Check server logs for Supabase write errors
4. Verify `player_stats` table exists and RLS is configured
5. Test with SQL Editor:
   ```sql
   SELECT * FROM player_stats WHERE user_id = 'your-user-id';
   ```

---

## Service worker caches stale version

**Symptom**: Old game version loads after deploy.

**Fix**:
```
Chrome DevTools → Application → Service Workers → Update
```
Or force reload: `Ctrl+Shift+R` (hard reload bypasses service worker cache)

The `vite-plugin-pwa` with `registerType: 'autoUpdate'` should auto-update on new deploys.
