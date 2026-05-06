import Phaser from 'phaser';

interface HpBarState {
  bg: Phaser.GameObjects.Rectangle;
  fg: Phaser.GameObjects.Rectangle;
  hpPct: number;
}

const BAR_W = 28;
const BAR_H = 4;

export class HpBarManager {
  private readonly bars = new Map<string, HpBarState>();

  constructor(private readonly scene: Phaser.Scene) {}

  get size(): number {
    return this.bars.size;
  }

  create(entityId: string, sprite: Phaser.GameObjects.Sprite, hpPct: number): void {
    const clamped = Math.max(0, Math.min(1, hpPct));
    const barY = sprite.y - sprite.displayHeight - 4;
    const bg = this.scene.add
      .rectangle(sprite.x - BAR_W / 2, barY, BAR_W, BAR_H, 0x440000)
      .setOrigin(0, 0)
      .setDepth(sprite.depth + 1);
    const fg = this.scene.add
      .rectangle(sprite.x - BAR_W / 2, barY, BAR_W * clamped, BAR_H, 0x00cc00)
      .setOrigin(0, 0)
      .setDepth(sprite.depth + 2);
    this.bars.set(entityId, { bg, fg, hpPct: clamped });
  }

  update(
    entityId: string,
    hpPct: number,
    resolveSprite: () => Phaser.GameObjects.Sprite | undefined,
  ): void {
    const clamped = Math.max(0, Math.min(1, hpPct));
    const existing = this.bars.get(entityId);
    if (existing) {
      existing.hpPct = clamped;
      existing.fg.width = BAR_W * clamped;
      if (hpPct < 0.3) existing.fg.fillColor = 0xcc0000;
      else if (hpPct < 0.6) existing.fg.fillColor = 0xcccc00;
      else existing.fg.fillColor = 0x00cc00;
    } else {
      const sprite = resolveSprite();
      if (sprite) this.create(entityId, sprite, hpPct);
    }
  }

  remove(entityId: string): void {
    const bar = this.bars.get(entityId);
    if (bar) {
      bar.bg.destroy();
      bar.fg.destroy();
      this.bars.delete(entityId);
    }
  }

  updateAllPositions(
    resolveSprite: (id: string) => Phaser.GameObjects.Sprite | undefined,
  ): void {
    for (const [entityId, bar] of this.bars) {
      const sprite = resolveSprite(entityId);
      if (!sprite || !sprite.active) {
        this.remove(entityId);
        continue;
      }
      const barY = sprite.y - sprite.displayHeight - 4;
      bar.bg.setPosition(sprite.x - BAR_W / 2, barY);
      bar.fg.setPosition(sprite.x - BAR_W / 2, barY);
      bar.bg.setDepth(sprite.depth + 1);
      bar.fg.setDepth(sprite.depth + 2);
    }
  }

  destroy(): void {
    for (const bar of this.bars.values()) {
      bar.bg.destroy();
      bar.fg.destroy();
    }
    this.bars.clear();
  }
}
