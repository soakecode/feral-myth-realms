import Phaser from 'phaser';
import { t } from '../../i18n/index.js';
import { signIn, signUp, getCurrentSession } from '../../auth/supabaseClient.js';
import {
  createGuestSession,
  createRegisteredSession,
  saveSession,
} from '../../auth/sessionStore.js';
import { sanitizeAlias } from '@fmr/shared';
import { gothicScreen } from '../../ui/theme.js';

export class AuthScene extends Phaser.Scene {
  private authMode: 'guest' | 'login' | 'register' = 'guest';
  private onPopState = () => this.scene.start('MainMenuScene');

  constructor() {
    super({ key: 'AuthScene' });
  }

  init(data: { mode: 'guest' | 'login' | 'register' }) {
    this.authMode = data.mode ?? 'guest';
  }

  async create() {
    const overlay = document.getElementById('ui-overlay')!;
    overlay.innerHTML = '';
    this.pushNavigationState();

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

  private pushNavigationState() {
    try {
      window.history.pushState({ fmrScene: 'auth' }, '', window.location.href);
    } catch {
      // Embedded browsers can block history updates.
    }
    window.addEventListener('popstate', this.onPopState);
  }

  private renderForm(overlay: HTMLElement) {
    const isGuest = this.authMode === 'guest';
    const isRegister = this.authMode === 'register';

    const inner = `
      <div class="gcard">
        <h2 class="gtitle">${isGuest ? 'Viajero sin nombre' : isRegister ? 'Forja tu leyenda' : 'Regresa al reino'}</h2>
        <p class="gsub">${isGuest ? 'Elige el alias con el que te conocerán' : isRegister ? 'Tu progreso quedará grabado para siempre' : 'Tus hazañas te esperan'}</p>
        <div class="gorna"><i></i>⟡<i></i></div>

        ${isGuest ? `
          <label class="glabel">${t('auth_guest_alias')}</label>
          <input class="ginput" type="text" id="input-alias" placeholder="${t('auth_enter_alias')}" maxlength="20" autocomplete="off" />
        ` : `
          ${isRegister ? `
            <label class="glabel">${t('auth_username')}</label>
            <input class="ginput" type="text" id="input-username" placeholder="tu_nombre" maxlength="20" autocomplete="off" />
          ` : ''}
          <label class="glabel">${t('auth_email')}</label>
          <input class="ginput" type="email" id="input-email" placeholder="tu@email.com" autocomplete="email" />
          <label class="glabel">${t('auth_password')}</label>
          <input class="ginput" type="password" id="input-password" placeholder="••••••••" autocomplete="${isRegister ? 'new-password' : 'current-password'}" />
        `}

        <div class="gerr" id="auth-error"></div>
        <div class="gok" id="auth-success"></div>

        <button class="gbtn gold" id="btn-submit">
          ${isGuest ? 'Entrar al reino' : isRegister ? t('auth_register') : t('auth_login')}
        </button>
        <button class="gbtn dim" id="btn-back">${t('auth_back')}</button>

        ${!isGuest ? `
          <div class="gnote" style="text-align:center;margin-top:14px">
            ${isRegister
              ? `¿Ya tienes cuenta? <a class="glink" id="toggle-mode">Inicia sesión</a>`
              : `¿Sin cuenta? <a class="glink" id="toggle-mode">Regístrate</a>`
            }
          </div>
        ` : ''}
      </div>
    `;
    overlay.innerHTML = gothicScreen('auth-scene', inner);

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
    window.removeEventListener('popstate', this.onPopState);
    document.getElementById('ui-overlay')!.innerHTML = '';
  }
}
