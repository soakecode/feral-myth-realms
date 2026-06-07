# Troubleshooting - Feral Myth: Realms

## `npm` no carga en PowerShell

Sintoma:

```text
No se puede cargar el archivo npm.ps1 porque la ejecucion de scripts esta deshabilitada
```

Solucion:

```bash
npm.cmd install
npm.cmd run dev
```

Tambien puedes ejecutar los comandos desde CMD, Git Bash o una PowerShell con policy configurada por el usuario.

## Vite falla con `Access is denied`

Sintoma:

```text
Cannot read directory "../../../..": Access is denied.
Could not resolve ".../apps/client/vite.config.ts"
```

Esto puede ocurrir dentro del sandbox de Codex al cargar Vite/esbuild. En una terminal normal del proyecto, `npm run build` y `npm run dev` fueron verificados correctamente.

Soluciones:

- Ejecuta desde una terminal normal.
- En Codex, permite ejecucion fuera del sandbox para `npm.cmd run build` o `npm.cmd run dev`.
- Verifica que estas en `C:\Users\Germa\Desktop\feral-myth-realms`.

## El servidor responde health pero no puedo entrar a room

Comprueba:

```bash
http://localhost:2567/health
http://localhost:2567/colyseus
```

Si `joinOrCreate("realm")` hace timeout:

1. Para procesos viejos de dev.
2. Revisa que no haya otro proceso en 2567.
3. Reinicia `npm run dev`.
4. Confirma en logs que aparece `Feral Myth: Realms server on port 2567`.

En Windows puedes localizar puertos con:

```bash
netstat -ano | findstr ":2567"
netstat -ano | findstr ":5173"
```

## WebSocket no conecta desde el cliente

Comprueba `VITE_GAME_SERVER_URL`.

Local:

```env
VITE_GAME_SERVER_URL=ws://localhost:2567
```

Dispositivo en la misma red:

```env
VITE_GAME_SERVER_URL=ws://TU_IP_LOCAL:2567
```

Tambien revisa firewall local y que `CLIENT_ORIGIN` coincida con el origen del cliente:

```env
CLIENT_ORIGIN=http://localhost:5173
```

## Guest mode falla

Guest mode no necesita Supabase.

Comprueba:

- `localStorage` permite escritura.
- Alias tiene al menos 2 caracteres.
- No hay errores en consola antes de `AuthScene`.
- `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` pueden estar vacias.

## Supabase no esta configurado

Mensaje esperado en servidor local:

```text
SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set - persistence will be disabled
```

Esto no es un error para guest mode. Solo significa que no habra persistencia.

Para auth real necesitas:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

La service role key nunca debe ir en variables `VITE_`.

## `npm run build` avisa de chunk grande

Sintoma:

```text
Some chunks are larger than 500 kB after minification
```

El build pasa. El aviso viene de Phaser + Three.js en el bundle cliente. No bloquea el slice minimo.

Siguiente mejora recomendada:

- Code splitting por escenas/renderers.
- Revisar si se mantiene Three.js o se migra gameplay a Phaser.

## PWA no instala

Comprueba:

- `npm run build` genera `apps/client/dist/manifest.webmanifest`.
- `apps/client/dist/sw.js` existe.
- El favicon apunta a `/favicon.png`.
- El sitio se sirve en `localhost` o HTTPS.
- No hay service worker viejo cacheado.

Para limpiar cache:

1. DevTools > Application > Service Workers.
2. Unregister.
3. Hard reload.

## Dos pestanas entran a salas distintas

Usa `Unirse a sala cooperativa` para que el segundo cliente haga `joinOrCreate("realm")`.

Si creas dos salas privadas, no se veran entre si. Revisa el HUD: debe indicar la misma sala o el mismo room code.

## El ataque no hace dano

El ataque basico valida distancia en servidor. Si no hay dano:

- Acercate mas al enemigo.
- Usa clase con mas rango, por ejemplo `raven_witch`.
- Apunta con click o pulsa `J`.
- Verifica que el servidor sigue activo.

Limitacion actual: el ataque basico no valida arco exacto, solo rango.
