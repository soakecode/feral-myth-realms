# Architecture — Feral Myth: Realms

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser / PWA (port 5173)                                      │
│  ┌────────────┐  ┌──────────────┐  ┌────────────────────────┐  │
│  │ Phaser 3   │  │  HTML/CSS UI │  │  @supabase/supabase-js │  │
│  │ (Canvas)   │  │  (Overlay)   │  │  (anon key only)       │  │
│  └─────┬──────┘  └──────────────┘  └──────────┬─────────────┘  │
│        │  WebSocket (Colyseus SDK)             │ HTTPS REST     │
└────────┼──────────────────────────────────────┼────────────────┘
         │                                       │
         ▼                                       ▼
┌──────────────────────┐            ┌─────────────────────────┐
│  Colyseus Server     │            │  Supabase               │
│  Node.js (port 2567) │            │  ┌───────────────────┐  │
│  ┌──────────────┐    │            │  │ PostgreSQL         │  │
│  │  RealmRoom   │    │            │  │ profiles          │  │
│  │  DuelRoom    │    │            │  │ characters        │  │
│  └──────┬───────┘    │            │  │ player_stats      │  │
│         │             │            │  │ match_history     │  │
│  ┌──────▼───────────┐│            │  │ friend_codes      │  │
│  │ CombatSystem     ││            │  └───────────────────┘  │
│  │ EnemyAI          ││────────────│▶ service_role key       │
│  │ SanctuarySystem  ││  (server   │  (bypasses RLS)         │
│  └──────────────────┘│   side)    └─────────────────────────┘
└──────────────────────┘
```

## Responsibilities

### Client (`apps/client`)
- Renders the game world with Phaser 3 (Canvas/WebGL)
- Sends player input to server every 50ms (20hz)
- Interpolates server state for smooth visuals
- Manages UI scenes (HTML overlay + Phaser scenes)
- Handles Supabase Auth (anon key only)
- Session persistence via localStorage
- PWA registration and install prompt

### Server (`apps/server`)
- **Authoritative** game simulation (Colyseus)
- Validates all inputs server-side
- Runs enemy AI at 20hz tick rate
- Manages sanctuary capture logic
- Validates Supabase JWT for registered players
- Writes match history and stats via service role key
- CORS restricted to `CLIENT_ORIGIN`

### Supabase
- PostgreSQL: persistent player data
- Auth: email/password (extensible to OAuth)
- Row Level Security: users read/write own data only
- Server bypasses RLS via `service_role` key

### Shared (`packages/shared`)
- TypeScript types shared between client and server
- Balance constants (stats, cooldowns, XP)
- Protocol message keys
- Pure utility functions (clamp, distance, etc.)
- Compiled and imported by both apps

---

## Authentication Flow

```
Guest:
  1. Player enters alias in AuthScene
  2. createGuestSession() generates local guestId
  3. Session saved to localStorage
  4. Player joins Colyseus room with { alias, guestId }
  5. Server accepts without token validation
  6. No Supabase calls

Registered:
  1. Player signs in via supabase.auth.signInWithPassword()
  2. Access token stored in session
  3. Player joins Colyseus room with { alias, authToken, userId }
  4. Server calls validateSupabaseToken(token) → verifies JWT
  5. userId confirmed → stats written at match end
```

---

## Room Lifecycle

```
Client creates/joins room via @colyseus/sdk
  ↓
RealmRoom.onCreate() — init enemies, sanctuaries, set metadata
  ↓
RealmRoom.onJoin(client, options) — validate token, create PlayerSchema
  ↓
setSimulationInterval() — runs tick() at TICK_RATE (20hz)
  ↓
  Each tick:
    1. Process input queue per player
    2. Apply movement (server-authoritative bounds)
    3. Apply abilities / basic attacks
    4. Regenerate energy
    5. Respawn dead players
    6. Run EnemyAI.tick()
    7. Apply sanctuary capture progress
    ↓
  State broadcast via Colyseus StateSync (delta compression)
  ↓
RealmRoom.onLeave() — remove player from state
  ↓
RealmRoom.onDispose() — persist match, write stats
```

---

## Combat Flow

```
Client sends PlayerInputPayload { dx, dy, abilityKey, aimX, aimY }
  ↓
Server queues input for next tick
  ↓
CombatSystem.applyPlayerAttack() or applyAbility()
  ↓
Validates: player alive, cooldown ready, energy sufficient
  ↓
Applies damage to enemies/players in range
  ↓
Broadcasts DAMAGE_EVENT message to all clients
  ↓
Client shows damage number + hit flash
  ↓
On kill: awards XP, broadcasts ENEMY_DIED / PLAYER_DIED
```

---

## Technical Decisions

| Decision | Choice | Reason |
|---|---|---|
| Multiplayer | Colyseus | Authoritative rooms, delta-sync state, TypeScript native |
| Renderer | Phaser 3 | Mature, WebGL+Canvas, active ecosystem |
| Auth | Supabase | Free tier, built-in Auth, PostgreSQL, RLS |
| Monorepo | npm workspaces | Zero config, native to npm, no build tool needed for sharing |
| State sync | Colyseus @colyseus/core Schema | Automatic delta-only broadcasting |
| Input | 20hz client send, 20hz server tick | Balance between responsiveness and bandwidth |
| UI | HTML overlay + Phaser scenes | HTML CSS is faster for complex UI; Phaser for game world |
| Art | Procedural Canvas/SVG | No copyright concerns, instant iteration |

## Alternatives Considered

- **Socket.io**: rejected — no built-in room/state management
- **Unity WebGL**: rejected — large builds, complex CI, not web-native
- **Three.js**: rejected — no game loop or input primitives
- **Prisma ORM**: rejected — unnecessary for simple queries via supabase-js
- **React UI**: rejected — adds complexity; HTML overlay is sufficient for this scope
