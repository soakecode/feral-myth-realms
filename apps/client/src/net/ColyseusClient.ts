import { Client, Room } from '@colyseus/sdk';
import { ENV } from '../config/env.js';
import type { PlayerClass } from '@fmr/shared';

let _client: Client | null = null;
let _clientEndpoint = '';

function isLocalHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

export function getGameServerEndpoint(): string {
  const raw = (ENV.GAME_SERVER_URL || '').trim();
  let endpoint = raw || 'ws://localhost:2567';

  if (!/^[a-z]+:\/\//i.test(endpoint)) {
    const localPage = typeof window !== 'undefined' && isLocalHost(window.location.hostname);
    endpoint = `${localPage ? 'ws' : 'wss'}://${endpoint}`;
  }

  endpoint = endpoint
    .replace(/^http:\/\//i, 'ws://')
    .replace(/^https:\/\//i, 'wss://')
    .replace(/\/+$/, '');

  if (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    endpoint.startsWith('ws://') &&
    !endpoint.includes('localhost') &&
    !endpoint.includes('127.0.0.1')
  ) {
    endpoint = endpoint.replace(/^ws:\/\//i, 'wss://');
  }

  return endpoint;
}

export function getGameServerHttpEndpoint(): string {
  return getGameServerEndpoint()
    .replace(/^ws:\/\//i, 'http://')
    .replace(/^wss:\/\//i, 'https://');
}

export async function checkGameServerHealth(timeoutMs = 5000): Promise<{ ok: boolean; message: string }> {
  const url = `${getGameServerHttpEndpoint()}/health`;
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!resp.ok) return { ok: false, message: `Health ${resp.status} en ${url}` };
    return { ok: true, message: `Servidor OK (${getGameServerEndpoint()})` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'No se pudo contactar con /health';
    return { ok: false, message: `${msg} en ${url}` };
  } finally {
    window.clearTimeout(timer);
  }
}

function getClient(): Client {
  const endpoint = getGameServerEndpoint();
  if (!_client || _clientEndpoint !== endpoint) {
    _client = new Client(endpoint);
    _clientEndpoint = endpoint;
  }
  return _client;
}

export interface JoinRealmOptions {
  alias: string;
  classKey: PlayerClass;
  authToken?: string;
  guestId?: string;
  isPrivate?: boolean;
  roomCode?: string;
}

export interface JoinDuelOptions {
  alias: string;
  classKey: PlayerClass;
  authToken?: string;
  guestId?: string;
}

export async function createRealmRoom(options: JoinRealmOptions): Promise<Room> {
  const client = getClient();
  return client.create('realm', options);
}

export async function joinRealmRoom(roomId: string, options: JoinRealmOptions): Promise<Room> {
  const client = getClient();
  return client.joinById(roomId, options);
}

export async function joinOrCreateRealm(options: JoinRealmOptions): Promise<Room> {
  const client = getClient();
  return client.joinOrCreate('realm', options);
}

export async function createDuelRoom(options: JoinDuelOptions): Promise<Room> {
  const client = getClient();
  return client.create('duel', options);
}

export async function joinOrCreateDuel(options: JoinDuelOptions): Promise<Room> {
  const client = getClient();
  return client.joinOrCreate('duel', options);
}

export async function joinByCode(code: string, options: JoinRealmOptions): Promise<Room> {
  // Ask server to resolve room code → roomId
  const httpUrl = getGameServerHttpEndpoint();
  const resp = await fetch(`${httpUrl}/rooms/by-code/${code.toUpperCase()}`);
  if (!resp.ok) throw new Error('Room not found');
  const { roomId } = await resp.json() as { roomId: string };
  return joinRealmRoom(roomId, options);
}

export async function getAvailableRooms() {
  try {
    const httpUrl = getGameServerHttpEndpoint();
    const resp = await fetch(`${httpUrl}/rooms?roomName=realm`);
    if (!resp.ok) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await resp.json() as any[];
  } catch {
    return [];
  }
}

export function resetClient() {
  _client = null;
  _clientEndpoint = '';
}
