import { Client, Room } from '@colyseus/sdk';
import { ENV } from '../config/env.js';
import type { PlayerClass } from '@fmr/shared';

let _client: Client | null = null;

function getClient(): Client {
  if (!_client) {
    _client = new Client(ENV.GAME_SERVER_URL);
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
  const httpUrl = ENV.GAME_SERVER_URL.replace('ws://', 'http://').replace('wss://', 'https://');
  const resp = await fetch(`${httpUrl}/rooms/by-code/${code.toUpperCase()}`);
  if (!resp.ok) throw new Error('Room not found');
  const { roomId } = await resp.json() as { roomId: string };
  return joinRealmRoom(roomId, options);
}

export async function getAvailableRooms() {
  try {
    const httpUrl = ENV.GAME_SERVER_URL.replace('ws://', 'http://').replace('wss://', 'https://');
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
}
