# Roadmap — Feral Myth: Realms

## V1.0 — Vertical Slice (Current)

**Status**: In progress

- [x] Monorepo with npm workspaces
- [x] Phaser 3 client with procedural art
- [x] Colyseus server (RealmRoom + DuelRoom)
- [x] Supabase auth (email/password)
- [x] Guest mode
- [x] 4 playable classes with abilities
- [x] 3 PvE enemy types with server-side AI
- [x] 3 capturable sanctuaries
- [x] Real-time multiplayer (2–6 players)
- [x] 1v1 duel mode
- [x] XP / level progression
- [x] Death & respawn
- [x] In-game chat
- [x] ES/EN i18n
- [x] PWA (installable)
- [x] Deployment docs

---

## V1.1 — Polish

- [ ] Sprite animations (spritesheets instead of geometric shapes)
- [ ] Sound effects (Web Audio API — oscillators or free SFX)
- [ ] Background music (procedural or CC0)
- [ ] Ability visual effects improved (particle systems)
- [ ] Mobile touch controls (virtual joystick + buttons)
- [ ] Ping display in HUD
- [ ] Player list in lobby (show who's in room)
- [ ] Room list with live player count
- [ ] Bug fixes from playtesting

---

## V1.2 — Social Features

- [ ] Full friend system (add/remove friends via friend code)
- [ ] Persistent friend list in Supabase
- [ ] Private rooms with friend invite by code
- [ ] Player profile page (stats, character, level)
- [ ] Leaderboard (top players by XP or wins)
- [ ] Match history viewer

---

## V1.3 — Inventory & Progression

- [ ] Items system (equippable gear)
- [ ] Gold economy (earn gold in matches)
- [ ] Shop in lobby
- [ ] Consumable items (potions)
- [ ] Character stat growth on level-up
- [ ] Skill tree or talent unlock at levels 5/10/15

---

## V1.4 — Cosmetics (Ethical Monetization)

- [ ] Color palette variants per class (unlockable)
- [ ] Emote pack (bought or earned)
- [ ] Profile borders and banners
- [ ] No pay-to-win mechanics
- [ ] All gameplay content free

---

## V2.0 — World Expansion

- [ ] Multiple maps (Beach, Ruins, Volcano)
- [ ] 2 new classes (Bird Shaman, Serpent Rogue)
- [ ] Guild system
- [ ] Seasonal events
- [ ] Spectator mode
- [ ] Tournament bracket support
- [ ] Self-hosted server option
- [ ] Ranked matchmaking

---

## Technical Debt / Improvements

- [ ] Client-side prediction with server reconciliation
- [ ] Proper spritesheet-based animations
- [ ] Pathfinding for enemies (A* or navmesh)
- [ ] Map editor
- [ ] Unit tests for RealmRoom and DuelRoom
- [ ] E2E tests (Playwright)
- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Docker compose for local Supabase
- [ ] OpenTelemetry traces for server performance
