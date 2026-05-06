import Phaser from 'phaser';
import type { Position } from 'irij-shared/types';
import { tileCenterPx } from '../render/projection.js';
import { depthForDynamic } from '../render/ysort.js';
import type { EntityManager } from './EntityManager.js';

export interface EntityMovementState {
  from: Position;
  path: Position[];
  speedTps: number;
  startedAtMs: number;
  lastTileIdx: number;
  smoothOffset?: { x: number; y: number };
}

export class MovementInterpolator {
  readonly moveStates = new Map<string, EntityMovementState>();
  selfTilePosition: Position = { x: 25, y: 25 };

  constructor(
    private readonly entities: EntityManager,
    private readonly selfUserId: string,
    private readonly resolveSprite: (id: string) => Phaser.GameObjects.Sprite | undefined,
  ) {}

  startMovement(entityId: string, from: Position, path: Position[], speedTps: number): void {
    if (path.length === 0) return;
    this.moveStates.delete(entityId);
    const sprite = this.resolveSprite(entityId);
    if (sprite) {
      const fromPx = tileCenterPx(from.x, from.y);
      if (entityId === this.selfUserId) {
        const ox = sprite.x - fromPx.x;
        const oy = sprite.y - fromPx.y;
        this.applyMovement(entityId, from, path, speedTps,
          (ox !== 0 || oy !== 0) ? { x: ox, y: oy } : undefined);
        return;
      }
      sprite.setPosition(fromPx.x, fromPx.y);
      sprite.setDepth(depthForDynamic(from.y));
    }
    this.applyMovement(entityId, from, path, speedTps);
  }

  snapToPosition(entityId: string, pos: Position): void {
    this.moveStates.delete(entityId);
    this.entities.tilePositions.set(entityId, { x: pos.x, y: pos.y });
    if (entityId === this.selfUserId) {
      this.selfTilePosition = { x: pos.x, y: pos.y };
    }
    const sprite = this.resolveSprite(entityId);
    if (sprite) {
      const px = tileCenterPx(pos.x, pos.y);
      sprite.setPosition(px.x, px.y);
      sprite.setDepth(depthForDynamic(pos.y));
    }
  }

  removeEntity(entityId: string): void {
    this.moveStates.delete(entityId);
  }

  update(): string[] {
    if (this.moveStates.size === 0) return [];
    const now = Date.now();
    const completed: string[] = [];

    for (const [entityId, mstate] of this.moveStates) {
      const sprite = this.resolveSprite(entityId);
      if (!sprite) {
        completed.push(entityId);
        continue;
      }

      const elapsedMs = now - mstate.startedAtMs;
      const tilesElapsed = (elapsedMs * mstate.speedTps) / 1000;
      const idx = Math.floor(Math.max(0, tilesElapsed));

      if (idx > mstate.lastTileIdx) {
        const arrivedTile = mstate.path[idx - 1] ?? mstate.from;
        this.entities.tilePositions.set(entityId, { x: arrivedTile.x, y: arrivedTile.y });
        if (entityId === this.selfUserId) {
          this.selfTilePosition = { x: arrivedTile.x, y: arrivedTile.y };
        }
        mstate.lastTileIdx = idx;
      }

      if (tilesElapsed >= mstate.path.length) {
        const last = mstate.path[mstate.path.length - 1];
        if (last) {
          const px = tileCenterPx(last.x, last.y);
          sprite.setPosition(px.x, px.y);
          sprite.setDepth(depthForDynamic(last.y));
          this.entities.tilePositions.set(entityId, { x: last.x, y: last.y });
          if (entityId === this.selfUserId) {
            this.selfTilePosition = { x: last.x, y: last.y };
          }
        }
        completed.push(entityId);
        continue;
      }

      const subTile = tilesElapsed - idx;
      const startTile = idx === 0 ? mstate.from : (mstate.path[idx - 1] ?? mstate.from);
      const endTile = mstate.path[idx];
      if (!endTile) {
        completed.push(entityId);
        continue;
      }

      const startPx = tileCenterPx(startTile.x, startTile.y);
      const endPx = tileCenterPx(endTile.x, endTile.y);
      let x = startPx.x + (endPx.x - startPx.x) * subTile;
      let y = startPx.y + (endPx.y - startPx.y) * subTile;
      const lerpedY = startTile.y + (endTile.y - startTile.y) * subTile;

      if (mstate.smoothOffset) {
        const progress = Math.min(1, tilesElapsed);
        const blend = 1 - progress;
        x += mstate.smoothOffset.x * blend;
        y += mstate.smoothOffset.y * blend;
        if (progress >= 1) mstate.smoothOffset = undefined;
      }

      sprite.setPosition(x, y);
      sprite.setDepth(depthForDynamic(lerpedY));
    }

    for (const id of completed) {
      this.moveStates.delete(id);
    }

    return completed;
  }

  destroy(): void {
    this.moveStates.clear();
  }

  private applyMovement(
    entityId: string,
    from: Position,
    path: Position[],
    speedTps: number,
    smoothOffset?: { x: number; y: number },
  ): void {
    this.moveStates.set(entityId, {
      from: { x: from.x, y: from.y },
      path: path.map((p) => ({ x: p.x, y: p.y })),
      speedTps,
      startedAtMs: Date.now(),
      lastTileIdx: 0,
      smoothOffset,
    });
    this.entities.tilePositions.set(entityId, { x: from.x, y: from.y });
    if (entityId === this.selfUserId) {
      this.selfTilePosition = { x: from.x, y: from.y };
    }
  }
}
