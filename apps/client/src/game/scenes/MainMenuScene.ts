import Phaser from 'phaser';
import { t, setLocale, getLocale } from '../../i18n/index.js';
import { loadSession } from '../../auth/sessionStore.js';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';

    const session = loadSession();

    overlay.innerHTML = `
      <style>
        #main-menu {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; flex-direction:column;
          align-items:center; justify-content:center;
          background: radial-gradient(ellipse at center, #1a3a4a 0%, #1a1a2e 60%, #0d0d1a 100%);
          color:#fff;
          font-family:'Segoe UI',system-ui,sans-serif;
        }
        #main-menu h1 {
          font-size:clamp(28px,5vw,52px);
          color:#ffd700;
          text-shadow:0 0 30px rgba(255,215,0,0.5), 2px 2px 0 #000;
          margin-bottom:8px;
          letter-spacing:2px;
        }
        #main-menu .subtitle {
          font-size:14px; color:#aabbcc; margin-bottom:48px; letter-spacing:1px;
        }
        .menu-btn {
          width:260px; padding:14px 0;
          margin:6px;
          border:none; border-radius:8px;
          font-size:15px; font-weight:600; cursor:pointer;
          transition:transform 0.1s,box-shadow 0.1s;
          letter-spacing:0.5px;
        }
        .menu-btn:hover { transform:scale(1.03); box-shadow:0 4px 20px rgba(255,255,255,0.1); }
        .menu-btn:active { transform:scale(0.98); }
        .btn-primary { background:linear-gradient(135deg,#ffd700,#ffaa00); color:#1a1a2e; }
        .btn-secondary { background:linear-gradient(135deg,#2a2a5e,#1a1a4e); color:#fff; border:1px solid rgba(255,255,255,0.2); }
        .btn-danger { background:linear-gradient(135deg,#4a1a2e,#2e0a1a); color:#ffaaaa; border:1px solid rgba(255,100,100,0.3); }
        .locale-row { display:flex; gap:8px; margin-bottom:24px; }
        .locale-btn {
          padding:4px 12px; border:1px solid rgba(255,255,255,0.3);
          background:transparent; color:#ccc; cursor:pointer; border-radius:4px;
          font-size:12px;
        }
        .locale-btn.active { background:rgba(255,215,0,0.2); color:#ffd700; border-color:#ffd700; }
        .user-badge {
          margin-bottom:16px; padding:8px 20px;
          background:rgba(255,255,255,0.08);
          border:1px solid rgba(255,255,255,0.15);
          border-radius:20px; font-size:12px; color:#aabbcc;
        }
        .version { position:absolute; bottom:12px; right:16px; font-size:10px; color:rgba(255,255,255,0.2); }
        /* Animated particles */
        .particle {
          position:absolute; border-radius:50%;
          animation:float linear infinite;
          pointer-events:none;
        }
        @keyframes float {
          0% { transform:translateY(100vh) rotate(0deg); opacity:0; }
          10% { opacity:1; }
          90% { opacity:0.5; }
          100% { transform:translateY(-20vh) rotate(360deg); opacity:0; }
        }
      </style>
      <div id="main-menu">
        <!-- Background particles -->
        ${Array.from({ length: 12 }, (_, i) => {
          const size = Math.random() * 6 + 2;
          const left = Math.random() * 100;
          const delay = Math.random() * 8;
          const duration = Math.random() * 10 + 8;
          const colors = ['#ffd700', '#44ff88', '#4488ff', '#ff44aa'];
          const color = colors[i % colors.length];
          return `<div class="particle" style="width:${size}px;height:${size}px;left:${left}%;background:${color};animation-delay:${delay}s;animation-duration:${duration}s;"></div>`;
        }).join('')}

        <div class="locale-row">
          <button class="locale-btn ${getLocale() === 'es' ? 'active' : ''}" id="btn-locale-es">🇪🇸 ES</button>
          <button class="locale-btn ${getLocale() === 'en' ? 'active' : ''}" id="btn-locale-en">🇬🇧 EN</button>
        </div>

        <h1>${t('menu_title')}</h1>
        <p class="subtitle">${t('menu_subtitle')}</p>

        ${session ? `<div class="user-badge">
          ${session.mode === 'registered' ? `✓ ${t('auth_logged_as')} <strong>${session.displayName ?? session.alias}</strong>` : `👤 ${t('auth_guest_as')} <strong>${session.alias}</strong>`}
        </div>` : ''}

        <button class="menu-btn btn-primary" id="btn-guest">${t('btn_play_guest')}</button>
        <button class="menu-btn btn-secondary" id="btn-login">${t('btn_login')} / ${t('btn_register')}</button>
        ${session?.mode === 'registered' ? `<button class="menu-btn btn-danger" id="btn-logout">${t('btn_logout')}</button>` : ''}

        <span class="version">v0.1.0 — Feral Myth: Realms</span>
      </div>
    `;

    document.getElementById('btn-locale-es')?.addEventListener('click', () => {
      setLocale('es');
      this.scene.restart();
    });
    document.getElementById('btn-locale-en')?.addEventListener('click', () => {
      setLocale('en');
      this.scene.restart();
    });

    document.getElementById('btn-guest')?.addEventListener('click', () => {
      this.scene.start('AuthScene', { mode: 'guest' });
    });

    document.getElementById('btn-login')?.addEventListener('click', () => {
      this.scene.start('AuthScene', { mode: 'login' });
    });

    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      const { signOut } = await import('../../auth/supabaseClient.js');
      const { clearSession } = await import('../../auth/sessionStore.js');
      await signOut();
      clearSession();
      this.scene.restart();
    });
  }

  shutdown() {
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
