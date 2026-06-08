import Phaser from 'phaser';
import { LoadingScene } from './game/scenes/LoadingScene.js';
import { MainMenuScene } from './game/scenes/MainMenuScene.js';
import { AuthScene } from './game/scenes/AuthScene.js';
import { ClassSelectScene } from './game/scenes/ClassSelectScene.js';
import { LobbyScene } from './game/scenes/LobbyScene.js';
import { GameScene } from './game/scenes/GameScene.js';
import { ResultsScene } from './game/scenes/ResultsScene.js';
import { registerSW } from 'virtual:pwa-register';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    fmrCanInstallPWA?: () => boolean;
    fmrInstallPWA?: () => Promise<boolean>;
  }
}

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
let deferredPrompt: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e as BeforeInstallPromptEvent;
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
});

window.fmrCanInstallPWA = () => deferredPrompt !== null;
window.fmrInstallPWA = async () => {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  deferredPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  return choice.outcome === 'accepted';
};

registerSW({ immediate: true });

export default game;
