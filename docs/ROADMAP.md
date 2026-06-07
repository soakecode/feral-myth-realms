# Roadmap - Feral Myth: Realms

Este roadmap parte del vertical slice rescatado el 2026-06-07. Prioriza estabilidad local y multiplayer real antes de features.

## P0 - Mantener el slice jugable

- [ ] Crear tests automatizados de `RealmRoom`.
- [ ] Test de join/leave con dos clientes Colyseus.
- [ ] Test de input y movimiento server-side.
- [ ] Test de ataque a enemigo y respawn.
- [ ] Script de smoke test multiplayer reusable.
- [ ] Verificacion browser real con dos pestanas y capturas.

## P1 - Clarificar renderer cliente

- [ ] Decidir si el gameplay oficial sera Phaser o Three.js.
- [ ] Si se mantiene Three.js, documentarlo como parte del stack.
- [ ] Si se migra a Phaser, eliminar `Game3D` gradualmente.
- [ ] Evitar mantener dos renderers completos sin necesidad.

## P2 - Calidad tecnica

- [ ] Limpiar mojibake restante en UI y logs propios.
- [ ] Reducir bundle cliente con code splitting.
- [ ] Separar escenas auth/lobby/game en chunks.
- [ ] Anadir manejo explicito de errores de conexion en lobby.
- [ ] Mostrar room code de forma consistente en UI.
- [ ] Confirmar que `onLeave` distingue salida voluntaria y desconexion.

## P3 - Supabase preparado, no bloqueante

- [ ] Probar registro/login con proyecto Supabase de staging.
- [ ] Verificar migraciones desde cero.
- [ ] Verificar RLS.
- [ ] Verificar persistencia de stats solo para usuarios registrados.
- [ ] Confirmar que guest mode sigue funcionando sin variables.

## P4 - Gameplay minimo mejorado

- [ ] Validar ataque por arco o direccion, no solo distancia.
- [ ] Agregar barras de vida visibles para enemigos en renderer actual.
- [ ] Agregar feedback de cooldown mas claro.
- [ ] Revisar IA de enemigos y rango de aggro.
- [ ] Balancear spawn para que el primer enemigo sea facil de encontrar.

## P5 - PWA y despliegue

- [ ] Probar instalacion PWA en Chrome real.
- [ ] Revisar cache de service worker en deploy.
- [ ] Documentar hosting cliente/servidor separados.
- [ ] Revisar variables de entorno de produccion.

## Fuera de alcance hasta estabilizar

- Inventario.
- Monetizacion.
- Login social.
- Rankings complejos.
- Mapas grandes.
- Cinematicas.
- Sistema completo de amigos.
- Nuevas clases.
