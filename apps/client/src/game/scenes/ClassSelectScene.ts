import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import { CLASS_DEFINITIONS } from '@fmr/shared';
import type { PlayerClass } from '@fmr/shared';
import type { PlayerSession } from '../../auth/sessionStore.js';
import { saveSession } from '../../auth/sessionStore.js';

const CLASS_ORDER: PlayerClass[] = ['stag_druid', 'raven_witch', 'wolf_guardian', 'fox_trickster'];

const CLASS_ROLE_KEYS: Record<PlayerClass, string> = {
  stag_druid: 'class_role_support',
  raven_witch: 'class_role_mage',
  wolf_guardian: 'class_role_tank',
  fox_trickster: 'class_role_mobile',
};

const CLASS_NAME_KEYS: Record<PlayerClass, string> = {
  stag_druid: 'class_stag_druid',
  raven_witch: 'class_raven_witch',
  wolf_guardian: 'class_wolf_guardian',
  fox_trickster: 'class_fox_trickster',
};

export class ClassSelectScene extends Phaser.Scene {
  private session!: PlayerSession;
  private selected: PlayerClass = 'stag_druid';

  constructor() {
    super({ key: 'ClassSelectScene' });
  }

  init(data: { session: PlayerSession }) {
    this.session = data.session;
    this.selected = data.session.classKey ?? 'stag_druid';
  }

  create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';
    this.render(overlay);
  }

  private render(overlay: HTMLElement) {
    const cardsHtml = CLASS_ORDER.map((key) => {
      const def = CLASS_DEFINITIONS[key];
      const colorHex = `#${def.color.toString(16).padStart(6, '0')}`;
      const isSelected = key === this.selected;
      const abilities = Object.values(def.abilities)
        .map((a) => `<span class="ability-tag">${a.nameEs}</span>`)
        .join('');

      return `
        <div class="class-card ${isSelected ? 'selected' : ''}" data-class="${key}"
          style="--class-color:${colorHex}">
          <div class="class-avatar" style="background:${colorHex}22; border-color:${colorHex}44">
            <svg width="64" height="64" viewBox="0 0 64 64">
              ${this.getClassSVG(key, colorHex)}
            </svg>
          </div>
          <div class="class-name">${t(CLASS_NAME_KEYS[key] as any)}</div>
          <div class="class-role">${t(CLASS_ROLE_KEYS[key] as any)}</div>
          <div class="class-stats">
            <div class="stat-row"><span>HP</span><div class="stat-bar"><div style="width:${(def.stats.maxHp / 200) * 100}%;background:${colorHex}"></div></div></div>
            <div class="stat-row"><span>DMG</span><div class="stat-bar"><div style="width:${(def.stats.attackDamage / 30) * 100}%;background:${colorHex}"></div></div></div>
            <div class="stat-row"><span>SPD</span><div class="stat-bar"><div style="width:${(def.stats.moveSpeed / 220) * 100}%;background:${colorHex}"></div></div></div>
          </div>
          <div class="class-abilities">${abilities}</div>
        </div>
      `;
    }).join('');

    overlay.innerHTML = `
      <style>
        #class-select {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; flex-direction:column;
          align-items:center; justify-content:center;
          background:radial-gradient(ellipse at center,#1a2a3a 0%,#0d1a2e 60%,#080d1a 100%);
          font-family:'Segoe UI',system-ui,sans-serif;
          color:#fff; padding:20px; box-sizing:border-box;
        }
        #class-select h2 { font-size:24px; color:#ffd700; margin-bottom:24px; letter-spacing:1px; }
        .class-grid {
          display:flex; gap:16px; flex-wrap:wrap;
          justify-content:center; max-width:900px;
        }
        .class-card {
          background:linear-gradient(145deg,#1a1a3e,#111130);
          border:2px solid rgba(255,255,255,0.1);
          border-radius:12px; padding:20px 16px;
          width:190px; cursor:pointer;
          transition:transform 0.15s,border-color 0.15s,box-shadow 0.15s;
          text-align:center;
        }
        .class-card:hover {
          transform:translateY(-4px);
          border-color:var(--class-color);
          box-shadow:0 8px 30px rgba(0,0,0,0.4);
        }
        .class-card.selected {
          border-color:var(--class-color);
          background:linear-gradient(145deg,#1e1e4e,#161644);
          box-shadow:0 0 20px rgba(255,255,255,0.08), 0 0 0 1px var(--class-color);
        }
        .class-avatar {
          width:80px; height:80px; border-radius:50%;
          border:2px solid; margin:0 auto 10px;
          display:flex; align-items:center; justify-content:center;
        }
        .class-name { font-size:14px; font-weight:700; margin-bottom:2px; }
        .class-role { font-size:11px; color:#aabbcc; margin-bottom:10px; }
        .class-stats { margin-bottom:10px; }
        .stat-row { display:flex; align-items:center; gap:6px; margin-bottom:3px; }
        .stat-row span { width:28px; font-size:9px; color:#aabbcc; text-align:right; }
        .stat-bar {
          flex:1; height:5px; background:rgba(255,255,255,0.1);
          border-radius:3px; overflow:hidden;
        }
        .stat-bar > div { height:100%; border-radius:3px; }
        .class-abilities { display:flex; flex-wrap:wrap; gap:3px; justify-content:center; }
        .ability-tag {
          background:rgba(255,255,255,0.08); border-radius:3px;
          padding:2px 5px; font-size:9px; color:#ddd;
        }
        .btn-confirm {
          margin-top:24px; padding:14px 48px;
          background:linear-gradient(135deg,#ffd700,#ffaa00);
          color:#1a1a2e; border:none; border-radius:10px;
          font-size:16px; font-weight:700; cursor:pointer;
          transition:transform 0.1s;
        }
        .btn-confirm:hover { transform:scale(1.03); }
        .btn-back {
          margin-top:8px; padding:8px 24px;
          background:transparent; color:#aabbcc;
          border:1px solid rgba(255,255,255,0.15); border-radius:6px;
          font-size:13px; cursor:pointer;
        }
      </style>
      <div id="class-select">
        <h2>${t('class_select_title')}</h2>
        <div class="class-grid">${cardsHtml}</div>
        <button class="btn-confirm" id="btn-confirm">${t('btn_confirm_class')}</button>
        <button class="btn-back" id="btn-back">${t('auth_back')}</button>
      </div>
    `;

    overlay.querySelectorAll('.class-card').forEach((card) => {
      card.addEventListener('click', () => {
        this.selected = card.getAttribute('data-class') as PlayerClass;
        overlay.querySelectorAll('.class-card').forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
      });
    });

    document.getElementById('btn-confirm')?.addEventListener('click', () => {
      const updatedSession = { ...this.session, classKey: this.selected };
      saveSession(updatedSession);
      this.scene.start('LobbyScene', { session: updatedSession });
    });

    document.getElementById('btn-back')?.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });
  }

  private getClassSVG(key: PlayerClass, color: string): string {
    switch (key) {
      case 'stag_druid':
        return `<circle cx="32" cy="34" r="18" fill="${color}" opacity="0.9"/>
                <line x1="20" y1="20" x2="14" y2="6" stroke="${color}" stroke-width="3"/>
                <line x1="20" y1="20" x2="10" y2="12" stroke="${color}" stroke-width="2.5"/>
                <line x1="44" y1="20" x2="50" y2="6" stroke="${color}" stroke-width="3"/>
                <line x1="44" y1="20" x2="54" y2="12" stroke="${color}" stroke-width="2.5"/>
                <circle cx="26" cy="32" r="3" fill="white"/>
                <circle cx="38" cy="32" r="3" fill="white"/>`;
      case 'raven_witch':
        return `<polygon points="32,8 56,52 8,52" fill="${color}" opacity="0.9"/>
                <polygon points="32,44 20,28 44,28" fill="black" opacity="0.5"/>
                <circle cx="26" cy="34" r="3" fill="#ff4444"/>
                <circle cx="38" cy="34" r="3" fill="#ff4444"/>`;
      case 'wolf_guardian':
        return `<rect x="10" y="18" width="44" height="36" rx="6" fill="${color}" opacity="0.9"/>
                <polygon points="12,20 22,4 22,20" fill="${color}"/>
                <polygon points="52,20 42,4 42,20" fill="${color}"/>
                <circle cx="24" cy="32" r="3.5" fill="white"/>
                <circle cx="40" cy="32" r="3.5" fill="white"/>
                <circle cx="24" cy="32" r="2" fill="black"/>
                <circle cx="40" cy="32" r="2" fill="black"/>`;
      case 'fox_trickster':
        return `<polygon points="32,6 58,52 6,52" fill="${color}" opacity="0.9"/>
                <circle cx="32" cy="52" r="8" fill="white" opacity="0.8"/>
                <circle cx="24" cy="36" r="3" fill="white"/>
                <circle cx="40" cy="36" r="3" fill="white"/>
                <circle cx="24" cy="36" r="1.5" fill="black"/>
                <circle cx="40" cy="36" r="1.5" fill="black"/>`;
      default:
        return `<circle cx="32" cy="32" r="24" fill="${color}"/>`;
    }
  }

  shutdown() {
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
