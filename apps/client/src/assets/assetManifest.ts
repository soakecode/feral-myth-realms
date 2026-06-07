// Central registry of visual assets. The concept-art styleboards are large
// reference images (not technical spritesheets); use them as backgrounds, lore
// screens and palette references. See docs/ASSETS.md.

export const assetManifest = {
  concept: {
    realmsBiomes: '/assets/concept/realms-biomes.png',
    charactersClasses: '/assets/concept/characters-classes.png',
    enemiesCreatures: '/assets/concept/enemies-creatures.png',
    uiHud: '/assets/concept/ui-hud.png',
  },
} as const;

// Palette references extracted from the concept styleboards (used by the 3D
// biomes — see packages/shared/src/world). Kept here for UI theming too.
export const biomePalette = {
  emeraldGrove: { ground: 0x35562f, accent: 0x6fe08a },
  obsidianRuins: { ground: 0x2a2440, accent: 0x9a6cff },
  moonfenMarsh: { ground: 0x1f3a3f, accent: 0x4fd6c6 },
  sanctum: { ground: 0x4a6b58, accent: 0xffe08a },
} as const;
