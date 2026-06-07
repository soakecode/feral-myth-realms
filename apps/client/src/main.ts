import Phaser from 'phaser';
import { LoadingScene } from './game/scenes/LoadingScene.js';
import { MainMenuScene } from './game/scenes/MainMenuScene.js';
import { AuthScene } from './game/scenes/AuthScene.js';
import { ClassSelectScene } from './game/scenes/ClassSelectScene.js';
import { LobbyScene } from './game/scenes/LobbyScene.js';
import { GameScene } from './game/scenes/GameScene.js';
import { ResultsScene } from './game/scenes/ResultsScene.js';

const config: Phaser.Types.Core.GameConfig = {
  // CANVAS (2D) rather than AUTO/WebGL: more universally compatible on mobile
  // GPUs/browsers, where WebGL can fail and leave the canvas blank. This game is
  // light enough that the Canvas renderer performs fine.
  type: Phaser.CANVAS,
  parent: 'game-container',
  width: 1280,
  height: 720,
  backgroundColor: '#1a1a2e',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 1280,
    height: 720,
  },
  render: {
    antialias: true,
    pixelArt: false,
  },
  fps: {
    target: 60,
    forceSetTimeOut: false,
  },
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [
    LoadingScene,
    MainMenuScene,
    AuthScene,
    ClassSelectScene,
    LobbyScene,
    GameScene,
    ResultsScene,
  ],
};

const game = new Phaser.Game(config);

// PWA install prompt handling
let deferredPrompt: Event | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
});

// Service worker registration handled by vite-plugin-pwa
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.getRegistrations().then((regs) => {
      if (regs.length === 0) {
        console.log('[PWA] Service worker not registered yet (dev mode)');
      }
    });
  });
}

export default game;
