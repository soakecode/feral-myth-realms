# REDESIGN PLAN — Feral Myth: Realms (exploration vertical slice)

Fecha: 2026-06-07 · Parte del estado real tras la auditoría de Codex.

## Qué funciona ahora (conservar)
- Servidor Colyseus real (`RealmRoom`), modo guest sin Supabase, 2 jugadores sincronizados.
- Movimiento autoritativo en servidor + ataque/abilities server-side (`CombatSystem`).
- Enemigos server-side (`EnemyAI`, 3 tipos) con vida/daño/respawn.
- Render de gameplay en **Three.js** (`apps/client/src/game3d/Game3D.ts`), Phaser solo como shell de menús.
- Despliegue: cliente en Cloudflare Pages, servidor en Render.

## Qué no transmite "juego vivo" (arreglar)
- Mapa diminuto (1600×1200) con clamps hardcodeados `50..1550 / 50..1150`.
- Árboles/rocas eran decorativos client-side, **sin colisión**.
- Enemigos = formas sin nombre, vida ni feedback claro.
- Sin recursos, sin construcción, sin objetivos, sin progresión visible.

## Conservar / reutilizar
- `CombatSystem`, `EnemyAI`, schemas, protocolo `MSG`, flujo de salas, `Game3D` (extender, no reescribir).

## Assets detectados (concept art)
Estaban en la **raíz** con nombres ES. Copiados a `apps/client/public/assets/concept/`:
- `realms-biomes.png` — 3 biomas + tiles/props + paletas.
- `characters-classes.png` — clases.
- `enemies-creatures.png` — Wisp / Bramble Beast / Rune Imp con paletas y efectos.
- `ui-hud.png` — referencia de HUD.
Son **styleboards** (concept art grande), no spritesheets técnicos → uso como fondos/lore/bestiario y **referencia de paleta** para rediseñar placeholders 3D. Detalle en `docs/ASSETS.md`.

## Decisión de arquitectura (sync mínimo)
- **Obstáculos y zonas**: datos **estáticos en `@fmr/shared`** (`world/worldDef.ts`). Servidor los usa para colisión; cliente para render. No se sincronizan (ambos los tienen).
- **Recursos y construcciones**: **dinámicos** → `MapSchema` en servidor (auto-sync Colyseus). Cliente solo renderiza + envía `HARVEST`/`BUILD`.
- **Inventario**: campos numéricos en `PlayerSchema` (sincronizados).
- **Objetivos**: rastreados en cliente observando estado sincronizado (las acciones siguen siendo server-authoritative).

## Implementación por fases (este pase)
1. `world/worldDef.ts`: mapa 4000×3000, 5 zonas, obstáculos con colisión, spawns de recursos/enemigos.
2. Schemas: `ResourceNodeSchema`, `StructureSchema`, inventario en `PlayerSchema`, `resources`/`structures` en `RealmRoomState`.
3. Servidor: colisión en movimiento, `HARVEST`/`BUILD`, efecto de hoguera (cura), XP por recolectar/construir/capturar, init del mundo, bounds desde shared.
4. Enemigos: más enemigos por zona; identidad visual (nombre + barra de vida + forma/color por tipo).
5. Cliente `Game3D`: mapa grande, obstáculos data-driven, nodos de recurso + recolección, construcciones + menú de construir, HUD (recursos/objetivos/zona/minimapa), nombre de zona al entrar.
6. Objetivos: questline de onboarding.
7. Docs + validación (`typecheck`/`build`) + deploy.

## Riesgos técnicos
- No romper el sync existente → recursos/construcciones via schema, obstáculos estáticos.
- Bundle ya grande (Three.js); evitar precachear los PNG de concept en PWA.
- Colisión simple (círculo vs caja) suficiente para el slice; no físicas.

## Qué queda para siguientes fases
- Modelos low-poly animados (GLTF), fog of war real, persistencia Supabase de inventario, más construcciones (ward/bridge), bestiario con concept art, balance fino.
