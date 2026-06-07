import type { PlayerClass } from '@fmr/shared';
import { generateGuestId } from '@fmr/shared';

export interface PlayerSession {
  mode: 'guest' | 'registered';
  userId: string | null;
  guestId: string | null;
  alias: string;
  classKey: PlayerClass;
  authToken: string | null;
  displayName: string | null;
}

const SESSION_KEY = 'fmr_session';
const GUEST_ID_KEY = 'fmr_guest_id';

export function saveSession(session: PlayerSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadSession(): PlayerSession | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PlayerSession;
  } catch {
    return null;
  }
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function createGuestSession(alias: string, classKey: PlayerClass): PlayerSession {
  return {
    mode: 'guest',
    userId: null,
    guestId: getOrCreateGuestId(),
    alias,
    classKey,
    authToken: null,
    displayName: alias,
  };
}

function getOrCreateGuestId(): string {
  const existing = localStorage.getItem(GUEST_ID_KEY);
  if (existing) return existing;
  const guestId = generateGuestId();
  localStorage.setItem(GUEST_ID_KEY, guestId);
  return guestId;
}

export function createRegisteredSession(
  userId: string,
  alias: string,
  classKey: PlayerClass,
  authToken: string,
  displayName: string | null
): PlayerSession {
  return {
    mode: 'registered',
    userId,
    guestId: null,
    alias,
    classKey,
    authToken,
    displayName,
  };
}
