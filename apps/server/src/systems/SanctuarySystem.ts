import { ArraySchema, MapSchema } from '@colyseus/schema';
import { SanctuarySchema } from '../schema/SanctuarySchema.js';
import { PlayerSchema } from '../schema/PlayerSchema.js';
import { distance, SANCTUARY_CAPTURE_RADIUS, SANCTUARY_CAPTURE_SPEED, SANCTUARY_MAX_PROGRESS } from '@fmr/shared';

export function initSanctuaries(sanctuaries: ArraySchema<SanctuarySchema>) {
  const defs = [
    { id: 'sanctuary_center', x: 800, y: 600, radius: SANCTUARY_CAPTURE_RADIUS },
    { id: 'sanctuary_north', x: 800, y: 200, radius: SANCTUARY_CAPTURE_RADIUS },
    { id: 'sanctuary_south', x: 800, y: 1000, radius: SANCTUARY_CAPTURE_RADIUS },
  ];

  defs.forEach((d) => {
    const s = new SanctuarySchema();
    s.id = d.id;
    s.x = d.x;
    s.y = d.y;
    s.radius = d.radius;
    s.captureProgress = 0;
    s.captureTeam = -1;
    s.state = 'neutral';
    sanctuaries.push(s);
  });
}

export function tickSanctuaries(
  sanctuaries: ArraySchema<SanctuarySchema>,
  players: MapSchema<PlayerSchema>,
  deltaMs: number
) {
  sanctuaries.forEach((sanctuary) => {
    const playersInRange: PlayerSchema[] = [];
    players.forEach((p) => {
      if (!p.isAlive) return;
      if (distance(p.x, p.y, sanctuary.x, sanctuary.y) <= sanctuary.radius) {
        playersInRange.push(p);
      }
    });

    if (playersInRange.length === 0) return;

    // Determine which team dominates
    const teamCounts: Record<number, number> = {};
    playersInRange.forEach((p) => {
      teamCounts[p.teamId] = (teamCounts[p.teamId] ?? 0) + 1;
    });

    let dominantTeam = -1;
    let maxCount = 0;
    let contested = false;

    Object.entries(teamCounts).forEach(([team, count]) => {
      if (count > maxCount) {
        maxCount = count;
        dominantTeam = parseInt(team, 10);
        contested = false;
      } else if (count === maxCount) {
        contested = true;
      }
    });

    if (contested) return; // Disputed, no progress

    const speed = SANCTUARY_CAPTURE_SPEED * maxCount * (deltaMs / 1000) * 20;

    if (sanctuary.captureTeam === dominantTeam) {
      sanctuary.captureProgress = Math.min(SANCTUARY_MAX_PROGRESS, sanctuary.captureProgress + speed);
      sanctuary.state = sanctuary.captureProgress >= SANCTUARY_MAX_PROGRESS ? `captured_${dominantTeam === 0 ? 'a' : 'b'}` : 'capturing';
    } else {
      sanctuary.captureProgress -= speed;
      if (sanctuary.captureProgress <= 0) {
        sanctuary.captureProgress = 0;
        sanctuary.captureTeam = dominantTeam;
        sanctuary.state = 'neutral';
      } else {
        sanctuary.state = 'capturing';
      }
    }
  });
}
