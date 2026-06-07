import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import type { PlayerSession } from '../../auth/sessionStore.js';

export class ResultsScene extends Phaser.Scene {
  private session!: PlayerSession;
  private result!: {
    mode: string;
    winnerAlias: string | null;
    winnerUserId: string | null;
    durationMs: number;
    stats: Array<{ playerId: string; alias: string; hp: number; xpGained: number }>;
  };

  constructor() {
    super({ key: 'ResultsScene' });
  }

  init(data: { result: ResultsScene['result']; session: PlayerSession }) {
    this.result = data.result;
    this.session = data.session;
  }

  create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';

    const isWinner = this.result.winnerAlias === this.session.alias;
    const durationStr = this.formatDuration(this.result.durationMs);

    const statsHtml = this.result.stats.map((s) =>
      `<tr>
        <td>${s.alias}</td>
        <td>${s.hp}</td>
        <td>+${s.xpGained} XP</td>
      </tr>`
    ).join('');

    overlay.innerHTML = `
      <style>
        #results-scene {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; align-items:center; justify-content:center;
          background:radial-gradient(ellipse at center,#1a1a3e 0%,#0a0a1e 70%);
          font-family:'Segoe UI',system-ui,sans-serif; color:#fff;
        }
        .results-card {
          background:linear-gradient(145deg,#1a1a4a,#0d0d2e);
          border:1px solid rgba(255,215,0,0.3); border-radius:16px;
          padding:40px clamp(20px,6vw,48px); text-align:center; min-width:0; width:min(360px, 92vw);
          box-shadow:0 12px 60px rgba(0,0,0,0.6);
        }
        .result-title {
          font-size:36px; font-weight:900; margin-bottom:8px;
          text-shadow:0 0 30px currentColor;
        }
        .win { color:#ffd700; }
        .lose { color:#ff6666; }
        .result-subtitle { font-size:14px; color:#aabbcc; margin-bottom:24px; }
        .result-stats table { width:100%; border-collapse:collapse; margin:16px 0; }
        .result-stats th { font-size:11px; color:#667; text-transform:uppercase;
          padding:4px 8px; border-bottom:1px solid rgba(255,255,255,0.1); }
        .result-stats td { padding:8px; font-size:13px; border-bottom:1px solid rgba(255,255,255,0.05); }
        .result-duration { font-size:12px; color:#667; margin-bottom:24px; }
        .btn-row { display:flex; gap:12px; justify-content:center; }
        .res-btn {
          padding:12px 28px; border:none; border-radius:8px;
          font-size:14px; font-weight:600; cursor:pointer;
        }
        .res-btn-primary { background:linear-gradient(135deg,#ffd700,#ffaa00); color:#1a1a2e; }
        .res-btn-secondary {
          background:rgba(255,255,255,0.08); color:#aabbcc;
          border:1px solid rgba(255,255,255,0.15);
        }
        .mode-badge {
          display:inline-block; padding:3px 10px;
          background:rgba(255,215,0,0.15); border:1px solid rgba(255,215,0,0.3);
          border-radius:12px; font-size:11px; color:#ffd700; margin-bottom:16px;
        }
      </style>
      <div id="results-scene">
        <div class="results-card">
          <div class="mode-badge">${this.result.mode === 'duel' ? '⚔️ Duelo 1v1' : '🌍 Cooperativo'}</div>

          ${this.result.winnerAlias
            ? `<div class="result-title ${isWinner ? 'win' : 'lose'}">
                ${isWinner ? '🏆 ' + t('results_you_win') : '💀 ' + t('results_you_lose')}
              </div>
              <div class="result-subtitle">
                ${t('results_winner')}: <strong>${this.result.winnerAlias}</strong>
              </div>`
            : `<div class="result-title" style="color:#aabbcc">🤝 ${t('results_draw')}</div>`
          }

          <div class="result-stats">
            <table>
              <thead><tr>
                <th>Jugador</th>
                <th>HP final</th>
                <th>${t('results_xp_gained')}</th>
              </tr></thead>
              <tbody>${statsHtml}</tbody>
            </table>
          </div>

          <div class="result-duration">⏱ ${t('results_duration')}: ${durationStr}</div>

          <div class="btn-row">
            <button class="res-btn res-btn-primary" id="btn-play-again">${t('btn_play_again')}</button>
            <button class="res-btn res-btn-secondary" id="btn-menu">${t('btn_main_menu')}</button>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-play-again')?.addEventListener('click', () => {
      this.scene.start('LobbyScene', { session: this.session });
    });

    document.getElementById('btn-menu')?.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });
  }

  private formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const secs = s % 60;
    return `${m}:${String(secs).padStart(2, '0')}`;
  }

  shutdown() {
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
