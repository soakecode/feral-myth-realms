# Testing - Feral Myth: Realms

Esta guia cubre el vertical slice local actual. No marca checks como completados por defecto: usala para validar una sesion real.

## Comandos base

En PowerShell, si `npm` esta bloqueado por execution policy, usa `npm.cmd`.

```bash
npm install
npm run typecheck
npm run lint
npm run test
npm run build
npm run dev
```

Resultados esperados:

- `install`: termina sin errores.
- `typecheck`: termina sin errores.
- `lint`: termina sin errores.
- `test`: ejecuta 19 tests en `packages/shared` y 2 tests en `apps/server`.
- `build`: genera `apps/client/dist` y `apps/server/dist`.
- `dev`: deja activos Vite y Colyseus.

## Smoke test local

1. Ejecuta `npm run dev`.
2. Abre `http://localhost:2567/health`.
3. Debe devolver JSON con `status: "ok"`.
4. Abre `http://localhost:5173`.
5. Debe cargar la pantalla inicial.

## Guest mode

1. Pulsa `Jugar como invitado`.
2. Escribe un alias de al menos 2 caracteres.
3. Continua a seleccion de clase.
4. Elige una clase.
5. Entra al lobby.
6. Crea o entra a sala realm.

Comprueba:

- No se requiere email.
- No se requiere Supabase.
- El alias se sanitiza.
- Se conserva un `guestId` en `localStorage` con clave `fmr_guest_id`.

## Prueba manual con dos jugadores

1. Abre pestana A en `http://localhost:5173`.
2. Entra como guest `Jugador1`.
3. Elige clase y entra a sala realm.
4. Abre pestana B.
5. Entra como guest `Jugador2`.
6. Usa `Unirse a sala cooperativa`.
7. Verifica que el HUD indica 2 jugadores.
8. Mueve A con WASD o flechas.
9. Verifica que B ve moverse a A.
10. Mueve B y verifica que A lo ve.
11. Acercate a un enemigo.
12. Pulsa `J` o click para atacar.
13. Verifica feedback visual de dano y cambio de vida/muerte del enemigo.

## Bucle de exploracion (vertical slice)

Con una sesion guest en una sala realm, valida el nuevo bucle:

1. **Mapa amplio**: el mundo es claramente grande (4000×3000). Apareces en el
   Santuario central. Muevete con WASD/joystick.
2. **Zonas**: sal del Santuario hacia arriba/abajo/lados. Aparece el **nombre de la
   zona** (Bosque Esmeralda, Ruinas Obsidiana, Marismas Lunaresa, Hondonada Sumida)
   y se marca el objetivo "explora un bioma".
3. **Colision**: choca contra arboles/rocas/ruinas → bloquean (te deslizas). Entra al
   agua de las marismas → te ralentiza.
4. **Recursos**: acercate a un nodo (cristal/tronco/piedra). Aparece "F · Recolectar".
   Pulsa `F` (o el boton ✋ tactil) → sube el contador del recurso en el HUD y ganas XP.
5. **Minimapa** (abajo-derecha): muestra biomas, recursos (turquesa), enemigos (rojo),
   santuarios (oro), jugadores (blanco/azul). Tu posicion se actualiza al moverte.
6. **Enemigos con identidad**: cada criatura tiene nombre y barra de vida. Atacalos
   (`J`/click). Al morir ganas XP segun tipo y avanza el objetivo de derrotas.
7. **Construccion**: junta 3 Madera + 2 Esencia. Pulsa `B` (o "Construir"), elige
   **Hoguera**, haz click para colocarla (no sobre obstaculos). Aparece y **cura** si
   te quedas cerca. El Totem cuesta 3 Piedra + 2 Esencia.
8. **Progresion**: al acumular XP subes de nivel (aviso visual, mejora de stats).
9. **Sincronizacion (2 pestanas)**: el recurso recolectado por A reduce el nodo para B;
   la construccion de A es visible para B; el inventario de cada jugador se sincroniza.
10. **Navegacion**: el boton de salida dice "Volver al campamento" en partida.

## Prueba automatizada de multiplayer

Con `npm run dev` activo, puedes ejecutar un cliente Node temporal con `@colyseus/sdk` para validar servidor sin navegador:

```bash
node --input-type=module path/to/check-colyseus.mjs
```

La prueba usada en rescate conecto dos clientes a `ws://localhost:2567`, uso `joinOrCreate("realm")`, envio input, confirmo misma room, dos jugadores, 8 enemigos, movimiento visible desde el segundo cliente y dano a enemigo.

## PWA

1. Ejecuta `npm run build`.
2. Verifica que existe `apps/client/dist/manifest.webmanifest`.
3. Verifica que existe `apps/client/dist/sw.js`.
4. Sirve el build con `npm run preview --workspace=apps/client`.
5. En Chrome, revisa Application > Manifest.

No se considera validada la instalacion PWA hasta probarla en navegador real.

## Supabase

Guest mode no necesita Supabase.

Para probar auth real:

1. Configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
2. Configura en servidor `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Ejecuta migraciones de `supabase/migrations`.
4. Prueba registro/login.
5. Confirma que el service role nunca aparece en el bundle cliente.

## Criterios minimos del slice

- [ ] Cliente carga en `localhost:5173`.
- [ ] Servidor responde en `localhost:2567/health`.
- [ ] Guest mode entra sin Supabase.
- [ ] Se puede elegir clase.
- [ ] Se puede entrar a `RealmRoom`.
- [ ] Dos pestanas ven dos jugadores.
- [ ] Movimiento se sincroniza.
- [ ] Hay enemigos.
- [ ] Ataque produce dano server-side.
- [ ] HUD muestra alias, clase, HP, energia, jugadores, sala y conexion.
- [ ] `typecheck`, `lint`, `test` y `build` pasan.
