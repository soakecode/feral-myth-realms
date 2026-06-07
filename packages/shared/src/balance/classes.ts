import type { PlayerClass } from '../types/index.js';

export interface ClassStats {
  maxHp: number;
  maxEnergy: number;
  moveSpeed: number;
  attackDamage: number;
  attackRange: number;
  attackCooldownMs: number;
  color: number; // hex color for placeholder rendering
}

export interface AbilityDef {
  key: string;
  nameEn: string;
  nameEs: string;
  energyCost: number;
  cooldownMs: number;
  damage: number;
  range: number;
  duration: number; // ms, 0 if instant
  radius: number;
  projectileSpeed: number; // 0 if not projectile
}

export interface ClassDef {
  key: PlayerClass;
  nameEn: string;
  nameEs: string;
  role: string;
  color: number;
  stats: ClassStats;
  abilities: Record<'q' | 'e' | 'r', AbilityDef>;
}

export const CLASS_DEFINITIONS: Record<PlayerClass, ClassDef> = {
  stag_druid: {
    key: 'stag_druid',
    nameEn: 'Stag Druid',
    nameEs: 'Ciervo Druida',
    role: 'Support/Control',
    color: 0x4caf50,
    stats: {
      maxHp: 120,
      maxEnergy: 100,
      moveSpeed: 160,
      attackDamage: 12,
      attackRange: 220,
      attackCooldownMs: 700,
      color: 0x4caf50,
    },
    abilities: {
      q: {
        key: 'q',
        nameEn: 'Healing Grove',
        nameEs: 'Bosquecillo Sanador',
        energyCost: 30,
        cooldownMs: 8000,
        damage: 0,
        range: 150,
        duration: 4000,
        radius: 60,
        projectileSpeed: 0,
      },
      e: {
        key: 'e',
        nameEn: 'Root Snare',
        nameEs: 'Trampa de Raíces',
        energyCost: 25,
        cooldownMs: 6000,
        damage: 8,
        range: 200,
        duration: 2000,
        radius: 40,
        projectileSpeed: 300,
      },
      r: {
        key: 'r',
        nameEn: 'Spirit Bloom',
        nameEs: 'Flor Espiritual',
        energyCost: 50,
        cooldownMs: 12000,
        damage: 35,
        range: 0,
        duration: 500,
        radius: 100,
        projectileSpeed: 0,
      },
    },
  },

  raven_witch: {
    key: 'raven_witch',
    nameEn: 'Raven Witch',
    nameEs: 'Cuervo Brujo',
    role: 'Magic DPS/Range',
    color: 0x7c4dff,
    stats: {
      maxHp: 90,
      maxEnergy: 130,
      moveSpeed: 170,
      attackDamage: 18,
      attackRange: 280,
      attackCooldownMs: 800,
      color: 0x7c4dff,
    },
    abilities: {
      q: {
        key: 'q',
        nameEn: 'Hex Orb',
        nameEs: 'Orbe Maldito',
        energyCost: 20,
        cooldownMs: 3000,
        damage: 25,
        range: 300,
        duration: 0,
        radius: 20,
        projectileSpeed: 350,
      },
      e: {
        key: 'e',
        nameEn: 'Blink Feather',
        nameEs: 'Pluma Parpadeo',
        energyCost: 35,
        cooldownMs: 7000,
        damage: 0,
        range: 180,
        duration: 0,
        radius: 0,
        projectileSpeed: 0,
      },
      r: {
        key: 'r',
        nameEn: 'Curse Field',
        nameEs: 'Campo Maldito',
        energyCost: 60,
        cooldownMs: 15000,
        damage: 8,
        range: 200,
        duration: 5000,
        radius: 80,
        projectileSpeed: 0,
      },
    },
  },

  wolf_guardian: {
    key: 'wolf_guardian',
    nameEn: 'Wolf Guardian',
    nameEs: 'Lobo Guardián',
    role: 'Tank/Melee',
    color: 0x607d8b,
    stats: {
      maxHp: 180,
      maxEnergy: 80,
      moveSpeed: 145,
      attackDamage: 22,
      attackRange: 80,
      attackCooldownMs: 600,
      color: 0x607d8b,
    },
    abilities: {
      q: {
        key: 'q',
        nameEn: 'Shield Howl',
        nameEs: 'Aullido Escudo',
        energyCost: 25,
        cooldownMs: 8000,
        damage: 0,
        range: 0,
        duration: 3000,
        radius: 0,
        projectileSpeed: 0,
      },
      e: {
        key: 'e',
        nameEn: 'Leap Slash',
        nameEs: 'Salto Tajo',
        energyCost: 30,
        cooldownMs: 5000,
        damage: 30,
        range: 200,
        duration: 300,
        radius: 50,
        projectileSpeed: 0,
      },
      r: {
        key: 'r',
        nameEn: 'Iron Pack',
        nameEs: 'Manada de Hierro',
        energyCost: 50,
        cooldownMs: 18000,
        damage: 0,
        range: 0,
        duration: 5000,
        radius: 120,
        projectileSpeed: 0,
      },
    },
  },

  fox_trickster: {
    key: 'fox_trickster',
    nameEn: 'Fox Trickster',
    nameEs: 'Zorro Ilusionista',
    role: 'Mobility/Deception',
    color: 0xff6f00,
    stats: {
      maxHp: 100,
      maxEnergy: 110,
      moveSpeed: 200,
      attackDamage: 14,
      attackRange: 120,
      attackCooldownMs: 500,
      color: 0xff6f00,
    },
    abilities: {
      q: {
        key: 'q',
        nameEn: 'Decoy',
        nameEs: 'Señuelo',
        energyCost: 30,
        cooldownMs: 9000,
        damage: 0,
        range: 100,
        duration: 4000,
        radius: 0,
        projectileSpeed: 0,
      },
      e: {
        key: 'e',
        nameEn: 'Quick Dash',
        nameEs: 'Estocada Rápida',
        energyCost: 20,
        cooldownMs: 4000,
        damage: 10,
        range: 150,
        duration: 200,
        radius: 0,
        projectileSpeed: 0,
      },
      r: {
        key: 'r',
        nameEn: 'Mirage Burst',
        nameEs: 'Explosión Espejismo',
        energyCost: 55,
        cooldownMs: 14000,
        damage: 28,
        range: 0,
        duration: 500,
        radius: 90,
        projectileSpeed: 0,
      },
    },
  },
};
