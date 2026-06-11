import Phaser from 'phaser';

export class LoadingScene extends Phaser.Scene {
  constructor() {
    super({ key: 'LoadingScene' });
  }

  preload() {
    const W = this.scale.width;
    const H = this.scale.height;

    // Background
    const bg = this.add.graphics();
    bg.fillStyle(0x1a1a2e);
    bg.fillRect(0, 0, W, H);

    // Title
    this.add.text(W / 2, H / 2 - 60, 'FERAL MYTH: REALMS', {
      fontSize: '28px',
      color: '#ffd700',
      stroke: '#000000',
      strokeThickness: 4,
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Progress bar
    const barW = 300;
    const barH = 12;
    const barX = W / 2 - barW / 2;
    const barY = H / 2 + 10;

    const barBg = this.add.graphics();
    barBg.fillStyle(0x333355, 1);
    barBg.fillRoundedRect(barX, barY, barW, barH, 6);

    const barFill = this.add.graphics();

    const loadText = this.add.text(W / 2, barY + 24, 'Cargando...', {
      fontSize: '13px',
      color: '#aaaacc',
    }).setOrigin(0.5);

    this.load.on('progress', (value: number) => {
      barFill.clear();
      barFill.fillStyle(0xffd700, 1);
      barFill.fillRoundedRect(barX, barY, barW * value, barH, 6);
      loadText.setText(`Cargando... ${Math.floor(value * 100)}%`);
    });
  }

  create() {
    // window.setTimeout instead of Phaser's delayedCall: the Phaser clock runs
    // on requestAnimationFrame, which browsers freeze in hidden/background
    // tabs — the game would sit on "Cargando..." forever if opened in one.
    window.setTimeout(() => {
      if (this.scene.isActive('LoadingScene')) this.scene.start('MainMenuScene');
    }, 300);
  }
}
