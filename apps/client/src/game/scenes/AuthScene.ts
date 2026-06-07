import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import { signIn, signUp, getCurrentSession } from '../../auth/supabaseClient.js';
import {
  createGuestSession,
  createRegisteredSession,
  saveSession,
} from '../../auth/sessionStore.js';
import { sanitizeAlias } from '@fmr/shared';

export class AuthScene extends Phaser.Scene {
  private authMode: 'guest' | 'login' | 'register' = 'guest';

  constructor() {
    super({ key: 'AuthScene' });
  }

  init(data: { mode: 'guest' | 'login' | 'register' }) {
    this.authMode = data.mode ?? 'guest';
  }

  async create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';

    // Check existing session
    if (this.authMode !== 'guest') {
      const session = await getCurrentSession();
      if (session?.user) {
        this.handleRegisteredLogin(session.access_token, session.user.id, session.user.email ?? '');
        return;
      }
    }

    this.renderForm(overlay);
  }

  private renderForm(overlay: HTMLElement) {
    const isGuest = this.authMode === 'guest';
    const isRegister = this.authMode === 'register';

    overlay.innerHTML = `
      <style>
        #auth-scene {
          position:absolute; top:0; left:0; width:100%; height:100%;
          display:flex; align-items:center; justify-content:center;
          background:rgba(15,15,30,0.97);
          font-family:'Segoe UI',system-ui,sans-serif;
        }
        .auth-card {
          background:linear-gradient(145deg,#1a1a3e,#0d0d2e);
          border:1px solid rgba(255,215,0,0.2);
          border-radius:14px; padding:36px clamp(20px,6vw,40px);
          width:min(340px, 92vw); color:#fff;
          box-shadow:0 8px 40px rgba(0,0,0,0.5);
        }
        .auth-card h2 { color:#ffd700; font-size:20px; margin-bottom:6px; }
        .auth-card p { color:#aabbcc; font-size:13px; margin-bottom:24px; }
        .form-group { margin-bottom:14px; }
        .form-group label { display:block; font-size:12px; color:#aabbcc; margin-bottom:4px; }
        .form-group input {
          width:100%; padding:10px 12px; background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.15); border-radius:6px;
          color:#fff; font-size:14px; outline:none; box-sizing:border-box;
        }
        .form-group input:focus { border-color:#ffd700; }
        .auth-btn {
          width:100%; padding:12px; margin-top:6px;
          border:none; border-radius:8px; font-size:15px;
          font-weight:600; cursor:pointer;
        }
        .auth-btn-primary { background:linear-gradient(135deg,#ffd700,#ffaa00); color:#1a1a2e; }
        .auth-btn-secondary {
          background:transparent; color:#aabbcc;
          border:1px solid rgba(255,255,255,0.15);
          margin-top:10px; font-size:13px;
        }
        .auth-btn-secondary:hover { background:rgba(255,255,255,0.05); }
        #auth-error {
          background:rgba(255,60,60,0.15); border:1px solid rgba(255,60,60,0.3);
          border-radius:6px; padding:8px 12px;
          font-size:12px; color:#ff8888; margin-top:10px;
          display:none;
        }
        #auth-success {
          background:rgba(60,255,100,0.15); border:1px solid rgba(60,255,100,0.3);
          border-radius:6px; padding:8px 12px;
          font-size:12px; color:#88ff88; margin-top:10px;
          display:none;
        }
        .toggle-link { text-align:center; margin-top:14px; font-size:12px; color:#aabbcc; }
        .toggle-link a { color:#ffd700; cursor:pointer; text-decoration:underline; }
      </style>
      <div id="auth-scene">
        <div class="auth-card">
          <h2>${isGuest ? '👤 Jugar como invitado' : isRegister ? '✨ Crear cuenta' : '🔑 Iniciar sesión'}</h2>
          <p>${isGuest ? 'Introduce tu alias para empezar' : isRegister ? 'Crea tu cuenta para guardar progreso' : 'Accede a tu cuenta'}</p>

          ${isGuest ? `
            <div class="form-group">
              <label>${t('auth_guest_alias')}</label>
              <input type="text" id="input-alias" placeholder="${t('auth_enter_alias')}" maxlength="20" autocomplete="off" />
            </div>
          ` : `
            ${isRegister ? `
              <div class="form-group">
                <label>${t('auth_username')}</label>
                <input type="text" id="input-username" placeholder="tu_nombre" maxlength="20" autocomplete="off" />
              </div>
            ` : ''}
            <div class="form-group">
              <label>${t('auth_email')}</label>
              <input type="email" id="input-email" placeholder="tu@email.com" autocomplete="email" />
            </div>
            <div class="form-group">
              <label>${t('auth_password')}</label>
              <input type="password" id="input-password" placeholder="••••••••" autocomplete="${isRegister ? 'new-password' : 'current-password'}" />
            </div>
          `}

          <div id="auth-error"></div>
          <div id="auth-success"></div>

          <button class="auth-btn auth-btn-primary" id="btn-submit">
            ${isGuest ? 'Continuar' : isRegister ? t('auth_register') : t('auth_login')}
          </button>
          <button class="auth-btn auth-btn-secondary" id="btn-back">${t('auth_back')}</button>

          ${!isGuest ? `
            <div class="toggle-link">
              ${isRegister
                ? `¿Ya tienes cuenta? <a id="toggle-mode">Inicia sesión</a>`
                : `¿Sin cuenta? <a id="toggle-mode">Regístrate</a>`
              }
            </div>
          ` : ''}
        </div>
      </div>
    `;

    document.getElementById('btn-back')?.addEventListener('click', () => {
      this.scene.start('MainMenuScene');
    });

    document.getElementById('toggle-mode')?.addEventListener('click', () => {
      this.authMode = this.authMode === 'login' ? 'register' : 'login';
      this.renderForm(overlay);
    });

    document.getElementById('btn-submit')?.addEventListener('click', () => {
      void this.handleSubmit();
    });

    // Enter key submit
    overlay.querySelectorAll('input').forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') void this.handleSubmit();
      });
    });

    // Focus first field
    setTimeout(() => {
      const first = overlay.querySelector('input') as HTMLInputElement | null;
      first?.focus();
    }, 100);
  }

  private showError(msg: string) {
    const el = document.getElementById('auth-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('auth-success')!.style.display = 'none';
  }

  private showSuccess(msg: string) {
    const el = document.getElementById('auth-success');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    document.getElementById('auth-error')!.style.display = 'none';
  }

  private async handleSubmit() {
    const btn = document.getElementById('btn-submit') as HTMLButtonElement;
    if (btn) btn.disabled = true;

    try {
      if (this.authMode === 'guest') {
        const aliasInput = document.getElementById('input-alias') as HTMLInputElement;
        const raw = aliasInput?.value.trim() ?? '';
        if (raw.length < 2) {
          this.showError(t('auth_error_short'));
          return;
        }
        const alias = sanitizeAlias(raw, 2, 20);
        const session = createGuestSession(alias, 'stag_druid');
        saveSession(session);
        this.scene.start('ClassSelectScene', { session });
      } else if (this.authMode === 'login') {
        const email = (document.getElementById('input-email') as HTMLInputElement)?.value.trim();
        const password = (document.getElementById('input-password') as HTMLInputElement)?.value;
        if (!email || !password) { this.showError(t('auth_error_empty')); return; }
        const data = await signIn(email, password);
        this.showSuccess(t('auth_success'));
        await this.handleRegisteredLogin(data.session!.access_token, data.user.id, data.user.email ?? '');
      } else {
        const username = (document.getElementById('input-username') as HTMLInputElement)?.value.trim();
        const email = (document.getElementById('input-email') as HTMLInputElement)?.value.trim();
        const password = (document.getElementById('input-password') as HTMLInputElement)?.value;
        if (!username || !email || !password) { this.showError(t('auth_error_empty')); return; }
        if (username.length < 2) { this.showError(t('auth_error_short')); return; }
        const data = await signUp(email, password, username);
        this.showSuccess(t('auth_registered'));
        if (data.session) {
          await this.handleRegisteredLogin(data.session.access_token, data.user!.id, email);
        } else {
          // Email confirmation required
          this.showSuccess('Revisa tu correo para confirmar la cuenta, luego inicia sesión.');
          this.authMode = 'login';
          setTimeout(() => this.renderForm(document.getElementById('ui-overlay')!), 2000);
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('err_unknown');
      this.showError(msg);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  private async handleRegisteredLogin(token: string, userId: string, email: string) {
    const { getProfile } = await import('../../auth/supabaseClient.js');
    const profile = await getProfile(userId);
    const alias = profile?.display_name ?? profile?.username ?? email.split('@')[0];
    const session = createRegisteredSession(userId, alias, 'stag_druid', token, alias);
    saveSession(session);
    this.scene.start('ClassSelectScene', { session });
  }

  shutdown() {
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
