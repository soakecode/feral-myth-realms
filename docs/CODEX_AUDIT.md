# CODEX AUDIT - Feral Myth: Realms

Fecha: 2026-06-07
Auditor: Codex

## Diagnostico ejecutivo

El proyecto no era una demo puramente local: existe un servidor Colyseus real, una `RealmRoom` real y un cliente que se conecta con `@colyseus/sdk`. Tambien habia problemas de rescate: `lint` estaba roto, PWA referenciaba un favicon inexistente, las docs sobreprometian y el cliente de gameplay actual no usa Phaser como renderer principal, sino Three.js dentro de una escena Phaser.

Despues del rescate minimo:

- Los comandos principales funcionan.
- El servidor y el cliente levantan localmente.
- El modo guest no depende de Supabase.
- Dos clientes Colyseus entran en la misma sala, ven dos jugadores, sincronizan movimiento y pueden danar enemigos.
- La documentacion fue rebajada a lo verificado.

## Estructura real

- `apps/client`: Vite + TypeScript + Phaser 3 + Three.js.
- `apps/server`: Node.js + Colyseus.
- `packages/shared`: tipos, mensajes, constantes, balance y utilidades compartidas.
- `supabase/migrations`: schema SQL, RLS y seed.
- `docs`: documentacion tecnica.

Nota critica: `apps/client/src/game/scenes/GameScene.ts` oculta el canvas Phaser y delega el gameplay en `apps/client/src/game3d/Game3D.ts`. Phaser sigue existiendo como shell de escenas, pero el render jugable actual no es Phaser puro.

## Verificaciones ejecutadas

```bash
npm.cmd install
# OK: up to date.

npm.cmd run typecheck
# OK.

npm.cmd run lint
# OK.

npm.cmd run test
# OK. 19 tests en packages/shared y 2 tests en apps/server.

npm.cmd run build
# En sandbox: falla al cargar Vite con Access is denied.
# Fuera del sandbox: OK. Cliente y servidor generan dist.

npm.cmd run dev
# En sandbox: Vite falla con Access is denied.
# Fuera del sandbox: OK. Cliente 5173 y servidor 2567 responden.
```

Endpoints verificados:

- `http://localhost:5173` devuelve 200.
- `http://localhost:2567/health` devuelve `{"status":"ok",...}`.
- `http://localhost:2567/colyseus` responde 200.

Prueba multiplayer automatizada con dos clientes Node Colyseus:

```json
{
  "sameRoom": true,
  "playerCountA": 2,
  "playerCountB": 2,
  "enemyCount": 8,
  "movementVisibleToB": true,
  "damagedEnemy": "enemy_7",
  "beforeHp": 45,
  "afterHp": 27,
  "attackDamagedEnemy": true
}
```

## Que funciona

- Workspaces npm.
- Cliente Vite en puerto 5173.
- Servidor Colyseus en puerto 2567.
- `RealmRoom` registrada como `realm`.
- `onJoin` crea jugadores en schema.
- `onLeave` elimina jugadores.
- Input de movimiento llega al servidor con `MSG.PLAYER_INPUT`.
- El servidor calcula movimiento y limita posicion.
- Estado compartido Colyseus sincroniza jugadores.
- Enemigos se crean server-side con `EnemyAI`.
- Dano y ataques pasan por `CombatSystem`.
- Guest mode funciona sin Supabase.
- `guestId` queda persistido en `localStorage`.
- HUD de gameplay muestra alias, clase, jugadores, sala, conexion, HP y energia.
- PWA build genera manifest y service worker.

## Que no funciona o no esta completamente probado

- No se pudo verificar visualmente con el navegador integrado de Codex porque el runtime fallo con `windows sandbox failed`.
- No hay tests automatizados para `RealmRoom`, `DuelRoom` ni matchmaking.
- Hay tests unitarios basicos de `CombatSystem`.
- No se verifico login Supabase end-to-end.
- No se verifico PWA instalada en navegador real.
- No se verifico el flujo completo de duelo.
- No se corrigio todo el mojibake heredado en UI/logs.

## Que esta simulado o incompleto

- Arte y mundo son procedurales/placeholders.
- El mapa no usa assets finales.
- El ataque basico valida distancia, no arco ni linea de vision.
- Persistencia Supabase es opcional y best-effort.
- El server no persiste stats para guests.
- Chat, duelo y santuarios existen, pero no forman parte del criterio minimo verificado.

## Que estaba roto y se corrigio

- `npm run lint` usaba `eslint . --ext .ts,.tsx`, incompatible con flat config.
  - Corregido a `eslint .`.
- `apps/client/index.html` apuntaba a `/favicon.ico`, pero el repo tiene `favicon.png`.
  - Corregido a `/favicon.png`.
- `vite.config.ts` incluia `favicon.ico` como asset.
  - Corregido a `favicon.png`.
- `guestId` se generaba por sesion.
  - Corregido para persistir `fmr_guest_id` en `localStorage`.
- HUD de gameplay no exponia datos minimos suficientes.
  - Agregado alias, clase, jugadores, sala, estado y controles.
- Lint tenia warnings triviales de unused y `any`.
  - Eliminados.

## Riesgos criticos restantes

1. Falta cobertura automatizada de salas Colyseus.
2. El gameplay actual depende de Three.js aunque el stack esperado menciona Phaser 3.
3. Bundle cliente grande: Vite reporta un chunk de unos 2.1 MB sin gzip.
4. Supabase no fue probado end-to-end.
5. Las rutas de UI con duelo, chat, sala privada y santuarios pueden tener bugs no cubiertos.
6. El build/dev en el sandbox de Codex falla por permisos al cargar Vite; en terminal normal si funciona.

## Prioridad de siguientes correcciones

1. Tests automatizados de `RealmRoom`: join, leave, input, movimiento, dano.
2. Prueba browser real con dos pestanas y screenshots.
3. Decidir si el renderer oficial sera Phaser o Three.js; documentar o migrar.
4. Limpiar mojibake restante en UI.
5. Separar chunks de cliente para reducir warning de bundle.
6. Probar Supabase con un proyecto real de staging.
7. Revisar duelo y room codes despues del slice realm.
