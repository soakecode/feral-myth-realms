import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import type { I18nKeys } from '../../i18n/es.js';
import { CLASS_DEFINITIONS } from '@fmr/shared';
import type { PlayerClass } from '@fmr/shared';
import type { PlayerSession } from '../../auth/sessionStore.js';
import { saveSession } from '../../auth/sessionStore.js';
import { getClassPortrait, loadClassPortrait } from '../../ui/portraits.js';

const CLASS_ORDER: PlayerClass[] = ['stag_druid', 'raven_witch', 'wolf_guardian', 'fox_trickster'];

const CLASS_ROLE_KEYS: Record<PlayerClass, I18nKeys> = {
  stag_druid: 'class_role_support',
  raven_witch: 'class_role_mage',
  wolf_guardian: 'class_role_tank',
  fox_trickster: 'class_role_mobile',
};

const CLASS_NAME_KEYS: Record<PlayerClass, I18nKeys> = {
  stag_druid: 'class_stag_druid',
  raven_witch: 'class_raven_witch',
  wolf_guardian: 'class_wolf_guardian',
  fox_trickster: 'class_fox_trickster',
};

const CLASS_BG: Record<PlayerClass, string> = {
  stag_druid: 'radial-gradient(ellipse at 50% 28%,rgba(76,175,80,.3),rgba(8,13,10,.95) 70%)',
  raven_witch: 'radial-gradient(ellipse at 50% 28%,rgba(124,77,255,.3),rgba(9,7,16,.95) 70%)',
  wolf_guardian: 'radial-gradient(ellipse at 50% 28%,rgba(144,164,174,.28),rgba(7,13,18,.95) 70%)',
  fox_trickster: 'radial-gradient(ellipse at 50% 28%,rgba(255,112,67,.3),rgba(18,10,7,.95) 70%)',
};

export class ClassSelectScene extends Phaser.Scene {
  private session!: PlayerSession;
  private selected: PlayerClass = 'stag_druid';
  private onPopState = () => this.scene.start('MainMenuScene');

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
    this.pushNavigationState();
    this.render(overlay);
  }

  private pushNavigationState() {
    try {
      window.history.pushState({ fmrScene: 'class-select' }, '', window.location.href);
    } catch {
      // Embedded browsers can block history updates.
    }
    window.addEventListener('popstate', this.onPopState);
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
          style="--class-color:${colorHex};--class-bg:${CLASS_BG[key]}">
          <div class="class-portrait" aria-hidden="true">
            <img data-pk="${key}" src="${getClassPortrait(key)}" alt="${t(CLASS_NAME_KEYS[key])}" />
          </div>
          <div class="class-name">${t(CLASS_NAME_KEYS[key])}</div>
          <div class="class-role">${t(CLASS_ROLE_KEYS[key])}</div>
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
          align-items:center; justify-content:flex-start; overflow-y:auto;
          background:
            radial-gradient(ellipse at 50% -10%,#2c3f56 0%,rgba(20,28,40,.6) 45%,rgba(8,10,14,0) 70%),
            radial-gradient(ellipse at 50% 115%,#1d2a1f 0%,rgba(10,14,11,.5) 40%,rgba(8,10,14,0) 70%),
            linear-gradient(180deg,#0b1018,#080a0e);
          font-family:'Segoe UI',system-ui,sans-serif;
          color:#fff; padding:18px; box-sizing:border-box;
        }
        #class-select h2 { font-family:'Cinzel Decorative','Cinzel',Georgia,serif; font-size:clamp(22px,4vw,34px); color:#ffd98a; margin:4px 0 18px; letter-spacing:1px; text-shadow:0 0 22px rgba(255,200,90,.4),0 3px 18px #000; }
        .class-grid {
          display:grid; grid-template-columns:repeat(4,minmax(160px,1fr)); gap:14px;
          width:min(1040px,100%); justify-content:center;
        }
        .class-card {
          position:relative; overflow:hidden;
          background:var(--class-bg),rgba(9,12,16,.92);
          border:1px solid rgba(220,174,87,0.35);
          border-radius:8px; padding:0 12px 14px;
          min-height:440px; cursor:pointer;
          transition:transform 0.15s,border-color 0.15s,box-shadow 0.15s;
          text-align:center;
          box-shadow:inset 0 0 0 1px rgba(255,255,255,.04),0 16px 44px rgba(0,0,0,.4);
        }
        .class-card::before{content:"";position:absolute;inset:0;border:1px solid rgba(255,231,166,.14);pointer-events:none}
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
        .class-portrait{
          height:190px; margin:0 -12px 10px;
          display:flex; align-items:flex-end; justify-content:center;
          background:var(--class-bg);
        }
        .class-portrait img{
          height:178px; width:auto;
          filter:drop-shadow(0 10px 18px rgba(0,0,0,.65));
        }
        .class-name { font-family:Georgia,serif; font-size:16px; font-weight:700; margin-bottom:2px; color:#f5df9a; text-transform:uppercase; letter-spacing:.5px; }
        .class-role { font-size:11px; color:#d1c19b; margin-bottom:10px; text-transform:uppercase; }
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
          background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,.08); border-radius:4px;
          padding:3px 6px; font-size:9px; color:#ddd;
        }
        .btn-confirm {
          margin-top:24px; padding:14px 48px;
          font-family:'Cinzel',Georgia,serif; letter-spacing:2px;
          background:linear-gradient(135deg,#f6cf6a,#e7b34a 55%,#c98f2e);
          color:#2a1c06; border:1px solid #ffe7a8; border-radius:10px;
          font-size:15px; font-weight:700; cursor:pointer;
          box-shadow:0 8px 26px rgba(255,180,60,.25),inset 0 1px 0 rgba(255,255,255,.55);
          transition:transform 0.1s, filter .2s;
        }
        .btn-confirm:hover { transform:scale(1.03); filter:brightness(1.06); }
        .btn-back {
          margin-top:8px; padding:9px 24px;
          font-family:'Cinzel',Georgia,serif; letter-spacing:1px;
          background:transparent; color:#a99a78;
          border:1px solid rgba(255,216,138,.25); border-radius:7px;
          font-size:12px; cursor:pointer;
        }
        @media (max-width: 760px) {
          #class-select { padding:12px; }
          .class-grid { grid-template-columns:repeat(2,minmax(140px,1fr)); gap:10px; }
          .class-card { min-height:360px; padding:0 10px 12px; }
          .class-portrait { height:126px; margin:0 -10px 8px; }
          .class-avatar { width:52px; height:52px; }
          .class-name { font-size:13px; }
          .ability-tag { font-size:8px; }
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

    // Upgrade portraits to the professional GLB renders as they load.
    for (const key of CLASS_ORDER) {
      void loadClassPortrait(key).then((src) => {
        const img = overlay.querySelector<HTMLImageElement>(`img[data-pk="${key}"]`);
        if (img) img.src = src;
      });
    }

    document.getElementById('btn-confirm')?.addEventListener('click', () => {
      const updatedSession = { ...this.session, classKey: this.selected };
      saveSession(updatedSession);
      this.scene.start('LobbyScene', { session: updatedSession });
    });

    document.getElementById('btn-back')?.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });
  }

  shutdown() {
    window.removeEventListener('popstate', this.onPopState);
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
