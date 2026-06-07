# Feral Myth: Realms

**Multiplayer tactical action RPG** — web/PWA built with Phaser 3 + Colyseus + Supabase.

> Criaturas antropomórficas de fantasía compiten y cooperan por el control de santuarios rúnicos en un archipiélago mítico.

---

## Stack

| Layer | Technology |
|---|---|
| Client | Phaser 3 · Vite · TypeScript · PWA |
| Server | Node.js · Colyseus · TypeScript |
| Auth & DB | Supabase (PostgreSQL + Auth) |
| Shared | TypeScript monorepo (npm workspaces) |
| Tests | Vitest |
| Lint/Format | ESLint + Prettier |

---

## Requisitos

- **Node.js ≥ 18**
- **npm ≥ 9** (workspaces support)
- Cuenta en [Supabase](https://supabase.com) (opcional para modo guest)

---

## Instalación local

```bash
# 1. Clonar o extraer el proyecto
cd feral-myth-realms

# 2. Instalar dependencias (todos los workspaces)
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Edita .env con tus claves de Supabase (ver sección Variables)

# 4. Generar iconos PWA (una sola vez)
node apps/client/scripts/gen-png-icons.cjs

# 5. Arrancar cliente y servidor en paralelo
npm run dev
```

---

## Scripts

| Comando | Descripción |
|---|---|
| `npm run dev` | Arranca cliente (5173) y servidor (2567) en paralelo |
| `npm run dev:client` | Solo cliente Vite |
| `npm run dev:server` | Solo servidor Colyseus |
| `npm run build` | Compila todo (shared → client → server) |
| `npm run test` | Ejecuta tests (Vitest) |
| `npm run lint` | ESLint sobre todo el proyecto |
| `npm run format` | Prettier sobre todo el proyecto |
| `npm run typecheck` | TypeScript sin emitir |

---

## Cómo ejecutar el juego

### Opción A: Modo invitado (sin Supabase)

1. Copia `.env.example` → `.env` — deja las vars de Supabase vacías
2. `npm run dev`
3. Abre `http://localhost:5173`
4. Haz clic en **"Jugar como invitado"**
5. Introduce un alias → elige clase → entra al lobby

### Opción B: Con Supabase (cuenta persistente)

1. Crea proyecto en [supabase.com](https://supabase.com)
2. Copia la URL y las claves al `.env`
3. Ejecuta las migraciones SQL (ver `docs/DEPLOYMENT.md`)
4. `npm run dev`
5. Regístrate con email y contraseña

---

## Probar multijugador con dos jugadores

```
# Ventana / pestaña 1
http://localhost:5173
→ Jugar como invitado → alias: "Jugador1" → Crear sala cooperativa

# Ventana / pestaña 2 (o dispositivo en la misma red)
http://localhost:5173
→ Jugar como invitado → alias: "Jugador2" → Unirse a sala cooperativa
```

También puedes usar el **código de sala**: cópialo en el lobby y compártelo.

---

## Variables de entorno

### `.env` raíz / `apps/client/`

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
VITE_GAME_SERVER_URL=ws://localhost:2567
```

### `apps/server/` (mismas vars sin prefijo VITE)

```env
PORT=2567
NODE_ENV=development
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_ANON_KEY=tu-anon-key
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key   # SOLO en servidor, NUNCA en cliente
CLIENT_ORIGIN=http://localhost:5173
```

> ⚠️ La `SUPABASE_SERVICE_ROLE_KEY` da acceso administrativo completo. Jamás la incluyas en el cliente ni en el repositorio.

---

## Estructura del repositorio

```
feral-myth-realms/
├── apps/
│   ├── client/          # Phaser 3 + Vite (puerto 5173)
│   └── server/          # Colyseus Node.js (puerto 2567)
├── packages/
│   └── shared/          # Tipos, constantes y utilidades compartidas
├── supabase/
│   └── migrations/      # SQL: schema, RLS, seed
├── docs/                # Documentación técnica
├── .env.example         # Plantilla de variables de entorno
└── README.md
```

---

## Documentación detallada

| Archivo | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arquitectura, flujos, decisiones técnicas |
| [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md) | Clases, habilidades, enemigos, modos |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Despliegue en Vercel / Render / Fly.io |
| [docs/TESTING.md](docs/TESTING.md) | Cómo probar todo manualmente |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Hoja de ruta futura |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Errores frecuentes y soluciones |

---

## Ayuda y feedback

- Issues: abre un ticket en el repositorio
- Monitor Colyseus (dev): `http://localhost:2567/colyseus`
