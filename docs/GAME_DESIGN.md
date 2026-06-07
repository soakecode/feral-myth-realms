# Game Design Document — Feral Myth: Realms

## Concept

A 2D top-down tactical action RPG set in a mythical archipelago where anthropomorphic fantasy creatures compete and cooperate for control of runic sanctuaries.

**Target feel**: A simplified hybrid of action RPG, multiplayer arena, and light map strategy — fast to learn, deep to master.

---

## Playable Classes

### 1. Stag Druid (Ciervo Druida)
**Role**: Support / Control  
**Color**: Green (#4caf50)  
**Playstyle**: Heals allies, controls enemies with roots, area bursts. Best in groups.

| Stat | Value |
|---|---|
| HP | 120 |
| Energy | 100 |
| Move Speed | 160 |
| Attack Damage | 12 |
| Attack Range | 220 (ranged) |

| Ability | Key | Cost | Cooldown | Effect |
|---|---|---|---|---|
| Thorn Bolt | J/Click | — | 700ms | Ranged basic attack |
| Healing Grove | Q | 30 EN | 8s | Zone heal for nearby allies |
| Root Snare | E | 25 EN | 6s | Projectile that slows/roots |
| Spirit Bloom | R | 50 EN | 12s | Explosion of nature damage around caster |

---

### 2. Raven Witch (Cuervo Brujo)
**Role**: Magic DPS / Range  
**Color**: Purple (#7c4dff)  
**Playstyle**: High burst damage at range. Blink for escape. Fragile but lethal.

| Stat | Value |
|---|---|
| HP | 90 |
| Energy | 130 |
| Move Speed | 170 |
| Attack Damage | 18 |
| Attack Range | 280 (long range) |

| Ability | Key | Cost | Cooldown | Effect |
|---|---|---|---|---|
| Shadow Spark | J/Click | — | 800ms | Long-range basic attack |
| Hex Orb | Q | 20 EN | 3s | Homing dark projectile |
| Blink Feather | E | 35 EN | 7s | Short-range teleport toward cursor |
| Curse Field | R | 60 EN | 15s | Zone of ongoing magic damage |

---

### 3. Wolf Guardian (Lobo Guardián)
**Role**: Tank / Melee  
**Color**: Steel Blue (#607d8b)  
**Playstyle**: High HP, close-range fighter. Shields protect the team. Leaps to engage.

| Stat | Value |
|---|---|
| HP | 180 |
| Energy | 80 |
| Move Speed | 145 |
| Attack Damage | 22 |
| Attack Range | 80 (melee) |

| Ability | Key | Cost | Cooldown | Effect |
|---|---|---|---|---|
| Claw Strike | J/Click | — | 600ms | Fast melee attack |
| Shield Howl | Q | 25 EN | 8s | Temporary damage reduction buff |
| Leap Slash | E | 30 EN | 5s | Leap to cursor position, AoE on land |
| Iron Pack | R | 50 EN | 18s | Short-duration aura buff for nearby allies |

---

### 4. Fox Trickster (Zorro Ilusionista)
**Role**: Mobility / Deception  
**Color**: Orange (#ff6f00)  
**Playstyle**: Fastest class. Hits and runs. Decoys confuse enemies. Best 1v1.

| Stat | Value |
|---|---|
| HP | 100 |
| Energy | 110 |
| Move Speed | 200 |
| Attack Damage | 14 |
| Attack Range | 120 (short range) |

| Ability | Key | Cost | Cooldown | Effect |
|---|---|---|---|---|
| Spark Dagger | J/Click | — | 500ms | Quick short-range attack |
| Decoy | Q | 30 EN | 9s | Creates a decoy illusion |
| Quick Dash | E | 20 EN | 4s | Rapid dash in aim direction |
| Mirage Burst | R | 55 EN | 14s | Circular damage + visual confusion |

---

## Controls

| Action | Key |
|---|---|
| Move | WASD or Arrow Keys |
| Basic Attack | J or Left Click |
| Ability 1 | Q |
| Ability 2 | E |
| Ultimate | R |
| Chat | T |

Aim direction: **mouse cursor** (world coordinates sent with each input)

---

## Game Modes

### RealmRoom (Co-op / PvE)
- 2–6 players in same room
- Map: Mythical archipelago with forest, ruins, swamp zones
- Goal: Defeat enemies, capture sanctuaries, accumulate XP
- Sanctuaries grant XP and energy buffs when captured
- Guest and registered players can mix
- Duration: open-ended (until room is empty)

### DuelRoom (1v1 PvP)
- Exactly 2 players
- Arena map (small, symmetric)
- Duration: 3 minutes or first elimination
- Winner: player alive, or highest HP at time-out
- Result saved to match_history (registered players only)
- No PvE enemies in arena

---

## Map (RealmRoom)

```
Size: 1600 × 1200 units

Zones:
  [Forest NW]    .... open path ....   [Forest NE]
                   [Ruins Center]
  [Swamp SW]     .... open path ....   [Swamp SE]

Key positions:
  • Sanctuary Center: (800, 600) — main objective
  • Sanctuary North:  (800, 200) — contested early
  • Sanctuary South:  (800, 1000) — contested late

Enemy spawn zones:
  • NW corner (200, 200) — Wisps
  • NE corner (1400, 200) — Wisps
  • SW corner (200, 1000) — Wisps
  • SE corner (1400, 1000) — Wisps
  • West middle (300, 600) — Bramble Beasts
  • East middle (1300, 600) — Bramble Beasts
  • North center (800, 150) — Rune Imps
  • South center (800, 1050) — Rune Imps

Obstacles: 7 rock clusters positioned to create natural chokepoints
```

---

## PvE Enemies

### Wisp
- **HP**: 30 | **Speed**: 90 | **Damage**: 5
- **Aggro range**: 200 | **Attack range**: 50
- Behavior: Floats toward nearest player, attacks on contact
- XP reward: 10

### Bramble Beast
- **HP**: 80 | **Speed**: 60 | **Damage**: 14
- **Aggro range**: 160 | **Attack range**: 55
- Behavior: Slow melee tank, high damage per hit
- XP reward: 25

### Rune Imp
- **HP**: 45 | **Speed**: 110 | **Damage**: 8
- **Aggro range**: 240 | **Attack range**: 160
- Behavior: Erratic movement, ranged attack
- XP reward: 15

**Respawn**: All enemies respawn 15 seconds after death at their spawn point.

---

## Sanctuaries

A sanctuary is captured by standing within its radius (80 units).

| State | Condition |
|---|---|
| Neutral | No one nearby |
| Capturing | One team's players in range |
| Contested | Both teams in range — no progress |
| Captured (A/B) | 100 progress reached |

Capture speed: 0.5 progress/tick × player count (stacks up to ~3)

**Effects when captured**:
- Area grants energy regen bonus to owning team
- Periodic XP pulse to nearby allies

---

## Progression

- XP gained from: defeating enemies, capturing sanctuaries
- XP per level: `level × 100`
- Level-up effect: stat increases applied (future: unlock abilities)
- Guest players: XP tracked in room state only (not persisted)
- Registered players: XP, level, and stats saved to Supabase after match

---

## Future Features (Roadmap)

See [ROADMAP.md](ROADMAP.md)
