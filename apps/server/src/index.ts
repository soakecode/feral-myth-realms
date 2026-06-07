import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { Server, matchMaker } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { env } from './config/env.js';
import { RealmRoom } from './rooms/RealmRoom.js';
import { DuelRoom } from './rooms/DuelRoom.js';

// In Colyseus 0.17 the transport owns the HTTP server and Express app.
// Custom routes are registered through the `express` option callback; the
// matchmaking routes are mounted automatically during `gameServer.listen()`.
const gameServer = new Server({
  transport: new WebSocketTransport(),
  express: async (app) => {
    // Allow the configured origin, any deployment of this Cloudflare Pages
    // project (bare domain, branch aliases, per-deploy hashes), and localhost.
    const isAllowedOrigin = (origin?: string): boolean => {
      if (!origin) return true; // non-browser clients (no Origin header)
      if (origin === env.CLIENT_ORIGIN) return true;
      try {
        const host = new URL(origin).hostname;
        if (host === 'localhost' || host === '127.0.0.1') return true;
        if (host === 'feral-myth-realms.pages.dev' || host.endsWith('.feral-myth-realms.pages.dev')) return true;
      } catch {
        /* malformed origin */
      }
      return false;
    };
    app.use(
      cors({
        origin: (origin, cb) => cb(null, isAllowedOrigin(origin)),
        methods: ['GET', 'POST'],
        credentials: true,
      })
    );
    app.use(express.json());

    // Health check
    app.get('/health', (_req, res) => {
      res.json({ status: 'ok', timestamp: Date.now(), env: env.NODE_ENV });
    });

    // Room code lookup — allows client to find a room by its custom code
    app.get('/rooms/by-code/:code', async (req, res) => {
      try {
        const rooms = await matchMaker.query({ name: 'realm' });
        const found = rooms.find(
          (r: { metadata?: { roomCode?: string }; roomId: string }) =>
            r.metadata?.roomCode === req.params.code
        );
        if (!found) {
          res.status(404).json({ error: 'Room not found' });
          return;
        }
        res.json({ roomId: found.roomId });
      } catch (err) {
        console.error('[rooms/by-code]', err);
        res.status(500).json({ error: 'Internal error' });
      }
    });

    // List public realm rooms (used by the lobby)
    app.get('/rooms', async (req, res) => {
      try {
        const name = typeof req.query.roomName === 'string' ? req.query.roomName : 'realm';
        const rooms = await matchMaker.query({ name });
        res.json(
          rooms.map(
            (r: {
              roomId: string;
              clients: number;
              maxClients: number;
              metadata?: Record<string, unknown>;
            }) => ({
              roomId: r.roomId,
              clients: r.clients,
              maxClients: r.maxClients,
              metadata: r.metadata,
            })
          )
        );
      } catch (err) {
        console.error('[rooms]', err);
        res.json([]);
      }
    });

    // Dev tools (disabled in production)
    if (env.NODE_ENV !== 'production') {
      try {
        const m = await import('@colyseus/monitor');
        app.use('/colyseus', m.monitor());
        console.log(`   Monitor: http://localhost:${env.PORT}/colyseus`);
      } catch {
        console.warn('[server] @colyseus/monitor not available');
      }
    }
  },
});

gameServer.define('realm', RealmRoom);
gameServer.define('duel', DuelRoom);

gameServer
  .listen(Number(env.PORT))
  .then(() => {
    console.log(`🎮 Feral Myth: Realms server on port ${env.PORT} [${env.NODE_ENV}]`);
    console.log(`   Origin: ${env.CLIENT_ORIGIN}`);
  })
  .catch((err) => {
    console.error('[server] failed to start', err);
    process.exit(1);
  });
