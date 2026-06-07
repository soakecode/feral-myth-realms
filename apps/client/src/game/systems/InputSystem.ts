import Phaser from 'phaser';
import type { PlayerInputPayload, AbilityKey } from '@fmr/shared';

export class InputSystem {
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd: { up: Phaser.Input.Keyboard.Key; down: Phaser.Input.Keyboard.Key; left: Phaser.Input.Keyboard.Key; right: Phaser.Input.Keyboard.Key };
  private keys: { j: Phaser.Input.Keyboard.Key; q: Phaser.Input.Keyboard.Key; e: Phaser.Input.Keyboard.Key; r: Phaser.Input.Keyboard.Key; t: Phaser.Input.Keyboard.Key };
  private scene: Phaser.Scene;
  private seq = 0;
  private mouseDown = false;
  private aimX = 0;
  private aimY = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.cursors = scene.input.keyboard!.createCursorKeys();
    this.wasd = {
      up: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.keys = {
      j: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.J),
      q: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
      e: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      r: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      t: scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T),
    };

    scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      this.aimX = pointer.worldX;
      this.aimY = pointer.worldY;
    });

    scene.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.leftButtonDown()) {
        this.mouseDown = true;
        this.aimX = pointer.worldX;
        this.aimY = pointer.worldY;
      }
    });

    scene.input.on('pointerup', () => {
      this.mouseDown = false;
    });
  }

  collect(): PlayerInputPayload | null {
    let dx = 0;
    let dy = 0;

    if (this.cursors.left.isDown || this.wasd.left.isDown) dx -= 1;
    if (this.cursors.right.isDown || this.wasd.right.isDown) dx += 1;
    if (this.cursors.up.isDown || this.wasd.up.isDown) dy -= 1;
    if (this.cursors.down.isDown || this.wasd.down.isDown) dy += 1;

    let abilityKey: AbilityKey | null = null;
    if (this.mouseDown || Phaser.Input.Keyboard.JustDown(this.keys.j)) {
      abilityKey = 'basic';
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.q)) {
      abilityKey = 'q';
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.e)) {
      abilityKey = 'e';
    } else if (Phaser.Input.Keyboard.JustDown(this.keys.r)) {
      abilityKey = 'r';
    }

    if (dx === 0 && dy === 0 && abilityKey === null) return null;

    return {
      seq: this.seq++,
      dx,
      dy,
      abilityKey,
      aimX: this.aimX,
      aimY: this.aimY,
      timestamp: Date.now(),
    };
  }

  isChatKeyPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.keys.t);
  }

  setEnabled(enabled: boolean) {
    this.scene.input.keyboard!.enabled = enabled;
  }
}
