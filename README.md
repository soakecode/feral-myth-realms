# Feral Myth: Realms

Vertical slice web/PWA multijugador con cliente Vite, Phaser como shell de escenas, render de gameplay en Three.js y servidor Node.js + Colyseus.

El objetivo actual no es un RPG completo: es una base jugable local con modo guest, sala Colyseus real, dos jugadores sincronizados, movimiento, enemigos y ataque basico server-side.

## Estado verificado

- `npm install` funciona.
- `npm run typecheck` pasa.
- `npm run lint` pasa.
- `npm run test` pasa, con tests en `packages/shared` y `apps/server`.
- `npm run build` pasa en una terminal normal. En el sandbox de Codex/Vite puede fallar con `Access is denied`.
- `npm run dev` levanta cliente en `http://localhost:5173` y servidor en `http://localhost:2567`.
- Multiplayer real verificado con dos clientes Colyseus: misma room, dos jugadores, movimiento sincronizado y dano a enemigo.

## Stack

| Capa | Tecnologia |
|---|---|
| Cliente | Vite, TypeScript, Phaser 3, Three.js |
| Servidor | Node.js, Colyseus |
| Compartido | TypeScript workspace `@fmr/shared` |
| Auth/DB | Supabase opcional |
| Tests | Vitest |
| PWA | `vite-plugin-pwa` |

Nota tecnica: el repo conserva Phaser 3 para el ciclo de escenas, pero la escena de juego actual oculta el canvas de Phaser y delega el render en `apps/client/src/game3d/Game3D.ts`.

## Requisitos

- Node.js 18 o superior.
- npm con soporte de workspaces.
- Supabase es opcional. El modo guest funciona sin variables de Supabase.

En PowerShell de Windows, si `npm` falla por execution policy, usa `npm.cmd`.

## Instalacion

```bash
npm install
```

Puedes copiar `.env.example` a `.env`, pero para jugar en guest local no hace falta configurar Supabase.

## Variables

Cliente:

```env
VITE_GAME_SERVER_URL=ws://localhost:2567
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Servidor:

```env
PORT=2567
NODE_ENV=development
CLIENT_ORIGIN=http://localhost:5173
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

`SUPABASE_SERVICE_ROLE_KEY` solo pertenece al servidor. No debe exponerse en el cliente.

## Comandos

```bash
npm run dev
npm run typecheck
npm run lint
npm run test
npm run build
```

Puertos por defecto:

- Cliente: `http://localhost:5173`
- Servidor: `http://localhost:2567`
- Healthcheck: `http://localhost:2567/health`
- Monitor Colyseus dev: `http://localhost:2567/colyseus`

## Como jugar en guest

1. Ejecuta `npm run dev`.
2. Abre `http://localhost:5173`.
3. Pulsa `Jugar como invitado`.
4. Escribe un alias.
5. Elige una clase.
6. Crea o entra a una sala realm.

## Probar dos jugadores

1. Abre una pestana en `http://localhost:5173`.
2. Entra como guest con alias `Jugador1`.
3. Elige clase y crea/entra en sala realm.
4. Abre una segunda pestana o navegador.
5. Entra como guest con alias `Jugador2`.
6. Usa `Unirse a sala cooperativa`.
7. Mueve un jugador con WASD o flechas.
8. Verifica que el otro cliente ve el movimiento.
9. Usa `J` o click para atacar. Si estas cerca de un enemigo, el servidor aplica dano y hay feedback visual.

## Que funciona ahora (vertical slice de exploracion)

Bucle jugable: **explora → recolecta → derrota criaturas → construye → progresa**.

- Guest mode con `guestId` persistente en `localStorage` y seleccion de clase.
- Room Colyseus `realm` real: join/leave, estado compartido, multijugador sincronizado.
- **Mundo amplio 4000×3000** con 4 biomas (Bosque Esmeralda, Ruinas Obsidiana,
  Marismas Lunaresa, Hondonada Sumida) + Santuario central de aparicion.
- **Obstaculos con colision real** server-side (arboles/rocas/ruinas bloquean; agua ralentiza),
  con deslizamiento por ejes. Datos en `@fmr/shared` (`world/`), compartidos por cliente y servidor.
- **Recursos recolectables** (Esencia, Madera, Piedra, Fragmento runico): nodos sincronizados,
  recoleccion server-authoritative (`F` o boton tactil), respawn, inventario en HUD.
- **Construccion**: Hoguera (cura aliados cercanos) y Totem (revela zona). Validacion de coste y
  posicion en servidor; estructuras sincronizadas entre jugadores.
- **Enemigos con identidad** (Wisp, Bramble Beast, Rune Imp) con nombre, barra de vida,
  forma/color/animacion propios y recompensa de XP por tipo.
- **Objetivos** (questline de onboarding) y **progresion**: XP por recolectar/matar/construir,
  subida de nivel con mejora de stats.
- **HUD**: HP/EN/XP, recursos, objetivos, nombre de zona, **minimapa**, jugadores conectados,
  navegacion contextual ("Volver al campamento").
- Render 3D (Three.js, renderer Canvas-compatible) con iluminacion, sombras y camara isometrica.
- Assets de concept art localizados y documentados (`docs/ASSETS.md`, `assetManifest.ts`).
- PWA genera manifest y service worker en build.

## Limitaciones conocidas

- El gameplay renderiza con Three.js, no con sprites Phaser puros.
- Los assets son procedurales/placeholders.
- Tests de salas completas `RealmRoom` y `DuelRoom` aun no existen.
- Supabase esta preparado, pero el slice local validado usa guest mode.
- El ataque basico valida distancia, no arco/direccion exacta.
- El bundle cliente es grande por Three.js/Phaser; Vite avisa de chunk superior a 500 kB.
- La verificacion visual con navegador integrado de Codex fallo por el runtime del entorno; el multiplayer se verifico con clientes Colyseus Node.

Mas detalle en `docs/CODEX_AUDIT.md`, `docs/TESTING.md`, `docs/TROUBLESHOOTING.md` y `docs/ROADMAP.md`.
