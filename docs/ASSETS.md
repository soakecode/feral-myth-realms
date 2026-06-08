# ASSETS — Feral Myth: Realms

## Concept art (styleboards)

Cuatro styleboards de concept art fueron añadidos por el usuario en la **raíz** del
proyecto (nombres en español). Se **copiaron** a `apps/client/public/assets/concept/`
con nombres ASCII para poder servirlos por Vite. Los originales de la raíz están en
`.gitignore` (no se versionan; los servidos sí).

| Archivo servido | Origen (raíz) | Tipo | Uso actual | Uso futuro |
|---|---|---|---|---|
| `assets/concept/realms-biomes.png` | `reinos y biomas feral myth.png` | Concept art / paleta | **Referencia de paleta** de los 3 biomas (colores aplicados al mundo 3D); referenciado en `assetManifest.ts` | Fondo de pantalla de lore / selección de reino |
| `assets/concept/characters-classes.png` | `personajes y clases feral myth.png` | Concept art | Referencia de diseño de clases | Fondo de selección de clase / galería |
| `assets/concept/enemies-creatures.png` | `enemigos y criaturas.png` | Concept art / paleta | **Referencia de identidad y color** de Wisp / Bramble Beast / Rune Imp | Pantalla de Bestiario |
| `assets/concept/ui-hud.png` | `ui fántasy.png` | Concept art | Referencia de estilo del HUD | Rediseño fino del HUD |

## Por qué no se usan como spritesheets

Son **imágenes grandes (~2 MB cada una) de concept art**, no atlas técnicos con
celdas regulares. Recortarlas como sprites sería frágil. Por eso se usan como:

- **referencia de paleta** — los colores de cada bioma (`packages/shared/src/world/index.ts`,
  `ZONES[].color/accent`) y de cada enemigo (`apps/client/src/game3d/Game3D.ts`) provienen
  de estos styleboards;
- referencia visual para los placeholders 3D low-poly;
- fondos/lore/bestiario en fases futuras.

## Registro central

`apps/client/src/assets/assetManifest.ts` centraliza las rutas (`assetManifest.concept.*`)
y las paletas de bioma (`biomePalette`).

## PWA

Los styleboards están **excluidos del precache** del service worker
(`vite.config.ts` → `workbox.globIgnores`) para no inflar la PWA; se cargan bajo demanda.

## Limitaciones

- No hay sprites/atlas técnicos ni modelos GLTF todavía; el render 3D usa geometría
  procedural low-poly inspirada en estas paletas.
- Integrar los styleboards como fondos in-game y un Bestiario queda como siguiente fase.

## Estado tras la integracion visual

- `MainMenuScene` usa `realms-biomes.png` como fondo principal animado.
- `ClassSelectScene` usa `characters-classes.png` como recorte visual por clase
  mediante CSS (`background-position` por carta). No es un sprite recortado: es
  un uso controlado de la lamina completa.
- `LobbyScene` usa `realms-biomes.png` como fondo y `characters-classes.png` como
  retrato circular de la clase seleccionada.
- `Game3D` sigue usando geometria procedural, pero ahora los jugadores, enemigos
  y recursos incorporan siluetas, colores y marcadores inspirados en las laminas:
  astas/baculo del ciervo, alas/orbe del cuervo, escudo/espada del lobo, cola/dagas
  del zorro, enemigos mas diferenciados y recursos con etiqueta flotante.

## Para llegar a arte de produccion

Estas laminas son buenas como direccion visual, pero no sustituyen a un paquete de
assets tecnico. Para animacion y render de mayor calidad haria falta producir:
spritesheets con celdas regulares, atlas TexturePacker/Aseprite, o modelos GLTF/VRM
con animaciones. El siguiente paso razonable es separar assets en `characters`,
`enemies`, `resources`, `terrain` y `ui` en lugar de seguir recortando laminas
conceptuales completas.
