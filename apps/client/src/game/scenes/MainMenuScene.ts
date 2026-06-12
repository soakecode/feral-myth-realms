import Phaser from 'phaser';
import { t, setLocale, getLocale } from '../../i18n/index.js';
import { clearSession, loadSession } from '../../auth/sessionStore.js';

export class MainMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'MainMenuScene' });
  }

  create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';
    try {
      window.history.replaceState({ fmrScene: 'main-menu' }, '', window.location.href);
    } catch {
      // Embedded browsers can block history updates.
    }

    const session = loadSession();

    // Floating embers (atmosphere)
    const embers = Array.from({ length: 26 }, () => {
      const size = (Math.random() * 4 + 1.5).toFixed(1);
      const left = (Math.random() * 100).toFixed(1);
      const dur = (Math.random() * 9 + 7).toFixed(1);
      const delay = (Math.random() * 12).toFixed(1);
      const drift = (Math.random() * 80 - 40).toFixed(0);
      const hue = Math.random() > 0.5 ? '255,196,90' : '120,220,170';
      return `<span class="ember" style="--s:${size}px;left:${left}%;--d:${dur}s;animation-delay:-${delay}s;--x:${drift}px;background:rgba(${hue},0.9);box-shadow:0 0 8px 1px rgba(${hue},0.7)"></span>`;
    }).join('');

    overlay.innerHTML = `
      <style>
        #main-menu{position:absolute;inset:0;overflow:hidden;display:flex;flex-direction:column;
          align-items:center;justify-content:center;color:#f3ead6;font-family:'Cinzel',Georgia,serif;
          background:#080b10}
        #main-menu .bg{position:absolute;inset:-4%;transform:scale(1.03);
          animation:kenburns 38s ease-in-out infinite alternate;background:
          radial-gradient(circle at 70% 14%, rgba(218,228,255,.26) 0%, rgba(150,175,220,.08) 8%, rgba(0,0,0,0) 17%),
          radial-gradient(ellipse at 50% -14%, #2e425b 0%, rgba(26,36,50,.75) 36%, rgba(8,10,14,0) 66%),
          radial-gradient(ellipse at 14% 110%, #182a1d 0%, rgba(15,24,17,.65) 36%, rgba(8,10,14,0) 64%),
          radial-gradient(ellipse at 88% 106%, #2a1d11 0%, rgba(28,19,11,.55) 30%, rgba(8,10,14,0) 58%),
          linear-gradient(180deg,#0d1320,#07090d)}
        #main-menu .grad{position:absolute;inset:0;background:
          radial-gradient(ellipse at 50% 38%,rgba(10,16,22,0) 0%,rgba(8,11,16,.55) 62%,rgba(6,8,12,.95) 100%),
          linear-gradient(180deg,rgba(6,9,14,.7) 0%,rgba(6,9,14,0) 30%,rgba(6,9,14,.85) 100%)}
        #main-menu .fog{position:absolute;left:-30%;width:160%;height:60%;pointer-events:none;opacity:.5;
          background:radial-gradient(closest-side,rgba(150,200,180,.18),transparent 70%)}
        #main-menu .fog.f1{top:30%;animation:fog1 46s linear infinite}
        #main-menu .fog.f2{top:8%;height:80%;opacity:.35;
          background:radial-gradient(closest-side,rgba(120,150,255,.14),transparent 70%);animation:fog2 64s linear infinite}
        #main-menu .embers{position:absolute;inset:0;pointer-events:none}
        #main-menu .ember{position:absolute;bottom:-6%;width:var(--s);height:var(--s);border-radius:50%;
          animation:rise var(--d) linear infinite}
        #main-menu .vig{position:absolute;inset:0;box-shadow:inset 0 0 220px 60px rgba(0,0,0,.85);pointer-events:none}

        #main-menu .stage{position:relative;z-index:2;display:flex;flex-direction:column;align-items:center;
          text-align:center;padding:20px;max-width:92vw}
        #main-menu .crest{font-size:26px;color:#ffd98a;letter-spacing:8px;opacity:0;margin-bottom:4px;
          text-shadow:0 0 16px rgba(255,200,90,.7);animation:fadeUp .9s ease-out .15s forwards}
        #main-menu .title{font-family:'Cinzel Decorative','Cinzel',serif;font-weight:900;line-height:.92;
          font-size:clamp(46px,10.5vw,128px);letter-spacing:2px;margin:0;
          background:linear-gradient(100deg,#7a5a16 0%,#e7b54a 22%,#fff3c8 50%,#e7b54a 78%,#7a5a16 100%);
          background-size:220% auto;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
          filter:drop-shadow(0 3px 2px rgba(0,0,0,.85)) drop-shadow(0 0 26px rgba(255,196,80,.35));
          animation:titleRise 1.5s cubic-bezier(.16,.84,.24,1) both,shimmer 7s linear 1.5s infinite}
        #main-menu .title .sub{display:block;font-family:'Cinzel',serif;font-weight:600;
          font-size:clamp(20px,4.6vw,48px);letter-spacing:clamp(8px,3vw,26px);margin-top:2px;text-indent:.5em;
          -webkit-text-fill-color:#f0dca0;background:none;filter:drop-shadow(0 0 18px rgba(255,200,90,.5))}
        #main-menu .rule{display:flex;align-items:center;gap:14px;margin:18px 0 10px;opacity:0;
          animation:fadeUp .9s ease-out .9s forwards}
        #main-menu .rule i{display:block;width:clamp(60px,16vw,160px);height:1px;
          background:linear-gradient(90deg,transparent,rgba(255,216,138,.8),transparent)}
        #main-menu .rule span{color:#ffd98a;font-size:18px;text-shadow:0 0 12px rgba(255,200,90,.8)}
        #main-menu .tagline{font-family:'Cinzel',serif;font-size:clamp(13px,2.4vw,18px);letter-spacing:3px;
          color:#cdbfa0;opacity:0;text-shadow:0 2px 8px #000;animation:fadeUp 1s ease-out 1.1s forwards}
        #main-menu .badge{margin-top:22px;padding:8px 22px;border-radius:30px;font-size:13px;color:#e8dcc0;
          background:rgba(20,16,10,.5);border:1px solid rgba(255,216,138,.35);backdrop-filter:blur(4px);
          opacity:0;animation:fadeUp 1s ease-out 1.25s forwards}
        #main-menu .badge strong{color:#ffd98a}
        #main-menu .actions{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:26px;
          opacity:0;animation:fadeUp 1s ease-out 1.4s forwards}
        #main-menu .mbtn{position:relative;width:min(340px,82vw);padding:15px 0;border-radius:10px;cursor:pointer;
          font-family:'Cinzel',serif;font-weight:600;font-size:16px;letter-spacing:2px;
          transition:transform .12s ease,box-shadow .25s ease,filter .25s ease}
        #main-menu .mbtn:hover{transform:translateY(-2px)}
        #main-menu .mbtn:active{transform:translateY(0) scale(.99)}
        #main-menu .mbtn.primary{color:#2a1c06;border:1px solid #ffe7a8;
          background:linear-gradient(135deg,#f6cf6a,#e7b34a 55%,#c98f2e);
          box-shadow:0 0 0 1px rgba(0,0,0,.4),0 10px 30px rgba(255,180,60,.25),inset 0 1px 0 rgba(255,255,255,.6)}
        #main-menu .mbtn.primary:hover{filter:brightness(1.07);box-shadow:0 0 0 1px rgba(0,0,0,.4),0 14px 40px rgba(255,190,70,.5),inset 0 1px 0 rgba(255,255,255,.6)}
        #main-menu .mbtn.ghost{color:#f0e6cf;background:rgba(18,22,30,.55);border:1px solid rgba(255,216,138,.3);
          backdrop-filter:blur(4px)}
        #main-menu .mbtn.ghost:hover{border-color:rgba(255,216,138,.7);box-shadow:0 0 24px rgba(255,200,90,.18)}
        #main-menu .mbtn.danger{color:#ffb3b3;background:rgba(40,14,18,.5);border:1px solid rgba(255,120,120,.35);font-size:13px;padding:11px 0}
        #main-menu .locale{position:absolute;top:16px;right:18px;z-index:3;display:flex;gap:8px}
        #main-menu .locale button{padding:5px 12px;border-radius:6px;cursor:pointer;font-family:'Cinzel',serif;
          font-size:12px;letter-spacing:1px;color:#cdbfa0;background:rgba(12,16,22,.5);
          border:1px solid rgba(255,216,138,.25);backdrop-filter:blur(4px)}
        #main-menu .locale button.active{color:#ffd98a;border-color:rgba(255,216,138,.8);background:rgba(255,216,138,.12)}
        #main-menu .version{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:10px;
          letter-spacing:2px;color:rgba(245,234,214,.3);z-index:3}

        @keyframes kenburns{0%{transform:scale(1.06) translate(0,0)}100%{transform:scale(1.16) translate(-1.5%,-2%)}}
        @keyframes titleRise{0%{opacity:0;transform:translateY(46px) scale(.9);filter:blur(12px) drop-shadow(0 0 0 transparent)}
          60%{opacity:1;filter:blur(0)}100%{opacity:1;transform:none}}
        @keyframes shimmer{to{background-position:220% center}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}
        @keyframes rise{0%{transform:translateY(0) translateX(0);opacity:0}
          12%{opacity:1}88%{opacity:.8}100%{transform:translateY(-112vh) translateX(var(--x));opacity:0}}
        @keyframes fog1{0%{transform:translateX(-12%)}100%{transform:translateX(12%)}}
        @keyframes fog2{0%{transform:translateX(10%)}100%{transform:translateX(-14%)}}
        @media (prefers-reduced-motion:reduce){#main-menu *{animation-duration:.01ms!important;animation-iteration-count:1!important}}
      </style>
      <div id="main-menu">
        <div class="bg"></div>
        <div class="grad"></div>
        <div class="fog f1"></div>
        <div class="fog f2"></div>
        <div class="embers">${embers}</div>
        <div class="vig"></div>

        <div class="locale">
          <button class="${getLocale() === 'es' ? 'active' : ''}" id="btn-locale-es">🇪🇸 ES</button>
          <button class="${getLocale() === 'en' ? 'active' : ''}" id="btn-locale-en">🇬🇧 EN</button>
        </div>

        <div class="stage">
          <div class="crest">✦ ❡ ✦</div>
          <h1 class="title">Feral Myth<span class="sub">Realms</span></h1>
          <div class="rule"><i></i><span>⟡</span><i></i></div>
          <p class="tagline">${t('menu_subtitle')}</p>

          ${session ? `<div class="badge">${session.mode === 'registered'
            ? `✦ ${t('auth_logged_as')} <strong>${session.displayName ?? session.alias}</strong>`
            : `❂ ${t('auth_guest_as')} <strong>${session.alias}</strong>`}</div>` : ''}

          <div class="actions">
            <button class="mbtn primary" id="btn-guest">${session ? 'Continuar' : t('btn_play_guest')}</button>
            ${session?.mode === 'guest' ? `<button class="mbtn ghost" id="btn-change-guest">Cambiar invitado</button>` : ''}
            <button class="mbtn ghost" id="btn-login">${t('btn_login')} / ${t('btn_register')}</button>
            ${session?.mode === 'registered' ? `<button class="mbtn danger" id="btn-logout">${t('btn_logout')}</button>` : ''}
          </div>
        </div>

        <span class="version">FERAL MYTH · REALMS — v0.1.0</span>
      </div>
    `;

    document.getElementById('btn-locale-es')?.addEventListener('click', () => { setLocale('es'); this.scene.restart(); });
    document.getElementById('btn-locale-en')?.addEventListener('click', () => { setLocale('en'); this.scene.restart(); });
    document.getElementById('btn-guest')?.addEventListener('click', () => {
      if (session) this.scene.start('LobbyScene', { session });
      else this.scene.start('AuthScene', { mode: 'guest' });
    });
    document.getElementById('btn-change-guest')?.addEventListener('click', () => {
      clearSession();
      this.scene.start('AuthScene', { mode: 'guest' });
    });
    document.getElementById('btn-login')?.addEventListener('click', () => this.scene.start('AuthScene', { mode: 'login' }));
    document.getElementById('btn-logout')?.addEventListener('click', async () => {
      const { signOut } = await import('../../auth/supabaseClient.js');
      await signOut();
      clearSession();
      this.scene.restart();
    });
  }

  shutdown() {
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
