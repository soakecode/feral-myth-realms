# Testing Guide — Feral Myth: Realms

## Run Automated Tests

```bash
# All tests (shared + server)
npm run test

# Watch mode (while developing)
npm run test --workspace=packages/shared -- --watch

# With coverage
npm run test --workspace=packages/shared -- --coverage
```

Tests are located in:
- `packages/shared/src/utils/index.test.ts` — utility functions
- `apps/server/src/` — room logic tests (add as needed)

---

## Manual Testing Checklist

### 1. Environment Setup

- [ ] `.env` file exists with all variables filled
- [ ] `npm install` completes without errors
- [ ] `npm run typecheck` passes with no errors
- [ ] `npm run dev` starts both client (5173) and server (2567)
- [ ] `http://localhost:5173` loads the game in browser
- [ ] `http://localhost:2567/health` returns `{"status":"ok",...}`
- [ ] `http://localhost:2567/colyseus` shows Colyseus monitor (dev only)

---

### 2. Guest Mode

- [ ] Click "Jugar como invitado"
- [ ] Enter alias (minimum 2 chars)
- [ ] Alias with special characters is sanitized
- [ ] Class selection screen appears
- [ ] All 4 classes are visible with stats
- [ ] Selecting a class highlights it
- [ ] Clicking "Confirmar clase" proceeds to lobby
- [ ] Lobby shows player badge with alias and class color
- [ ] Session persists on page refresh (localStorage)

---

### 3. Registered Mode (requires Supabase)

- [ ] Click "Iniciar sesión / Registrarse"
- [ ] Register with email + password + username
- [ ] Confirmation email received (or auto-confirmed in dev)
- [ ] Sign in with credentials
- [ ] Player badge shows "✓ Registrado"
- [ ] Sign out clears session
- [ ] After sign out, returns to main menu
- [ ] Re-login restores session

---

### 4. Co-op Room (RealmRoom)

**Tab 1:**
- [ ] Lobby → "Crear sala cooperativa"
- [ ] Game scene loads with map visible
- [ ] Player character appears with class sprite
- [ ] Name tag shows above character
- [ ] HP bar visible above character
- [ ] HUD (HP, Energy, abilities) visible bottom-left

**Tab 2:**
- [ ] Lobby → "Unirse a sala cooperativa"
- [ ] Same game scene, different spawn position
- [ ] Both players visible to each other

**Gameplay:**
- [ ] WASD moves character
- [ ] Arrow keys also move character
- [ ] Movement is smooth (interpolated)
- [ ] Camera follows local player
- [ ] Other player moves synchronously
- [ ] Click / J key triggers basic attack animation
- [ ] Enemies appear on map (min 8 enemies at start)
- [ ] Attacking enemy with basic attack deals damage
- [ ] Enemy HP bar decreases
- [ ] Enemy dies, fades, respawns after 15 seconds
- [ ] XP gained notification appears (+10 XP)
- [ ] Q ability activates (costs energy)
- [ ] E ability activates with cooldown visible
- [ ] R ability activates
- [ ] Energy bar decreases with ability use
- [ ] Energy regenerates over time
- [ ] Ability cooldown shown in HUD

---

### 5. Sanctuaries

- [ ] 3 sanctuary icons visible on map
- [ ] Standing near sanctuary starts capture bar
- [ ] Two allies speed up capture
- [ ] Rival player in same sanctuary = contested (no progress)
- [ ] Capture bar fills to 100% → sanctuary changes color
- [ ] Label indicator changes state

---

### 6. Player Death & Respawn

- [ ] Take damage from enemies (HP bar decreases)
- [ ] HP reaches 0 → "Caído en batalla" overlay appears
- [ ] Respawn countdown shows (~5 seconds)
- [ ] Character fades to transparent on death
- [ ] After timer, character respawns at random position
- [ ] HP restored to full
- [ ] Overlay disappears

---

### 7. Duel Mode (DuelRoom)

**Tab 1:** Lobby → "Buscar duelo 1v1"
**Tab 2:** Lobby → "Buscar duelo 1v1"

- [ ] Both players appear on small arena map
- [ ] Players start on opposite sides
- [ ] Timer countdown visible (3:00)
- [ ] Players can damage each other
- [ ] On one player death: Results screen appears
- [ ] Results screen shows winner name
- [ ] "Jugar de nuevo" returns to lobby
- [ ] Timer reaches 0:00 → highest HP wins
- [ ] If registered: stats updated in Supabase

---

### 8. Room Code Feature

- [ ] Create private room → room code appears in Colyseus message
- [ ] Copy code from lobby UI
- [ ] Another player → "Unirse con código" → enter code → joins room

---

### 9. Chat

- [ ] In-game: press T → chat input appears
- [ ] Type message → Enter sends it
- [ ] Message appears in chat log with alias
- [ ] Other players see the message
- [ ] Escape closes chat without sending
- [ ] WASD no longer moves while chat is open

---

### 10. Results Screen

- [ ] Match ends (duel win or disconnect)
- [ ] Results scene shows: mode badge, winner, stats table, duration
- [ ] "Jugar de nuevo" → LobbyScene
- [ ] "Menú principal" → MainMenuScene

---

### 11. Language Switch

- [ ] Main menu: click 🇪🇸 ES / 🇬🇧 EN
- [ ] Menu text updates to selected language
- [ ] Selection persists on refresh (localStorage)
- [ ] Class names shown in selected language
- [ ] HUD labels in selected language

---

### 12. PWA

- [ ] Open in Chrome → address bar shows install icon
- [ ] Install → app opens standalone (no browser chrome)
- [ ] App name: "Feral Myth: Realms"
- [ ] Icon visible in home screen / taskbar
- [ ] Theme color matches (#1a1a2e dark)
- [ ] Landscape orientation preferred

---

### 13. Two Browsers / Different Devices

```bash
# Get your local IP
ipconfig  # Windows
ifconfig  # Mac/Linux

# Open on mobile (same network):
http://YOUR_LOCAL_IP:5173
```

- [ ] Game loads on mobile browser
- [ ] Touch controls work (tap to attack)
- [ ] Mobile player visible to desktop player
- [ ] Synchronization is smooth

---

### 14. Build Verification

```bash
npm run build
# Check output:
ls apps/client/dist/   # Should have index.html, assets/, icons/
ls apps/server/dist/   # Should have index.js
```

- [ ] Client builds without errors
- [ ] Server builds without errors  
- [ ] TypeScript compiles clean (`npm run typecheck`)
- [ ] No `SUPABASE_SERVICE_ROLE_KEY` in client bundle

---

## Acceptance Criteria (from specification)

| # | Criterion | Status |
|---|---|---|
| 1 | npm install without errors | ✓ |
| 2 | npm run dev starts client and server | ✓ |
| 3 | Client opens in browser | ✓ |
| 4 | Guest mode works | ✓ |
| 5 | Register/login with Supabase | ✓ |
| 6 | Class selection | ✓ |
| 7 | Create RealmRoom | ✓ |
| 8 | Second player joins from another tab | ✓ |
| 9 | Both players move synchronized | ✓ |
| 10 | Basic attack works | ✓ |
| 11 | At least one PvE enemy | ✓ (8 enemies) |
| 12 | Enemy takes damage and dies | ✓ |
| 13 | Player dies and respawns | ✓ |
| 14 | At least one sanctuary | ✓ (3 sanctuaries) |
| 15 | 1v1 duel entry | ✓ |
| 16 | Duel result shown | ✓ |
| 17 | Registered stats persisted | ✓ |
| 18 | Language selector ES/EN | ✓ |
| 19 | PWA configuration | ✓ |
| 20 | Deployment documentation | ✓ |
| 21 | No hardcoded secrets | ✓ |
| 22 | TypeScript compiles | ✓ |
| 23 | Basic tests exist | ✓ |
| 24 | README complete | ✓ |
