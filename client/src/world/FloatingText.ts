import Phaser from 'phaser';

export function showFloatingText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  color: string,
): void {
  const floatText = scene.add
    .text(x, y, text, {
      fontSize: '14px',
      fontStyle: 'bold',
      color,
      stroke: '#000000',
      strokeThickness: 2,
    })
    .setOrigin(0.5, 1)
    .setDepth(100_001);

  scene.tweens.add({
    targets: floatText,
    y: y - 30,
    alpha: 0,
    duration: 800,
    ease: 'Linear',
    onComplete: () => floatText.destroy(),
  });
}

export function showToast(scene: Phaser.Scene, message: string, color: string): void {
  const cx = scene.scale.width / 2;
  const toast = scene.add
    .text(cx, 90, message, {
      fontSize: '16px',
      color,
      backgroundColor: '#00000080',
      padding: { x: 8, y: 4 },
    })
    .setOrigin(0.5, 0)
    .setScrollFactor(0)
    .setDepth(100_001);

  scene.tweens.add({
    targets: toast,
    alpha: 0,
    duration: 2000,
    ease: 'Linear',
    onComplete: () => toast.destroy(),
  });
}

export class MoveRejectedToast {
  private current?: Phaser.GameObjects.Text;

  constructor(private readonly scene: Phaser.Scene) {}

  show(reason: string): void {
    if (this.current) {
      this.scene.tweens.killTweensOf(this.current);
      this.current.destroy();
      this.current = undefined;
    }
    const cx = this.scene.scale.width / 2;
    const toast = this.scene.add
      .text(cx, 60, `Tam se nedostaneš (${reason})`, {
        fontSize: '16px',
        color: '#e25c5c',
        backgroundColor: '#00000080',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5, 0)
      .setScrollFactor(0)
      .setDepth(100_001);
    this.current = toast;
    this.scene.tweens.add({
      targets: toast,
      alpha: 0,
      duration: 1500,
      ease: 'Linear',
      onComplete: () => {
        toast.destroy();
        if (this.current === toast) this.current = undefined;
      },
    });
  }

  destroy(): void {
    if (this.current) {
      this.current.destroy();
      this.current = undefined;
    }
  }
}
