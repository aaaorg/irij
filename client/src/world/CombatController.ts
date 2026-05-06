import Phaser from 'phaser';
import { Op } from 'irij-shared/messages';
import type { Position } from 'irij-shared/types';
import type { NakamaConnection } from '../nakama.js';
import type { EntityManager } from './EntityManager.js';
import type { MovementInterpolator } from './MovementInterpolator.js';

export class CombatController {
  pendingAttackTarget: string | null = null;
  private lastAttackRequestSentAt = 0;
  private lastApproachSentAt = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly entities: EntityManager,
    private readonly movement: MovementInterpolator,
    private readonly selfUserId: string,
  ) {}

  handleMobClick(
    targetMobId: string,
    conn: NakamaConnection,
    matchId: string,
    getNextSeq: () => number,
  ): void {
    const mobPos = this.entities.tilePositions.get(targetMobId);
    const selfPos = this.movement.selfTilePosition;
    const manhattanDist = mobPos
      ? Math.abs(selfPos.x - mobPos.x) + Math.abs(selfPos.y - mobPos.y)
      : Infinity;

    if (manhattanDist === 1) {
      this.pendingAttackTarget = targetMobId;
      this.lastAttackRequestSentAt = this.scene.time.now;
      const seq = getNextSeq();
      const payload = JSON.stringify({ target_id: targetMobId, client_seq: seq });
      conn.socket
        .sendMatchState(matchId, Op.ATTACK_REQUEST, payload)
        .catch((err) => console.warn('sendMatchState ATTACK_REQUEST failed', err));
    } else if (mobPos) {
      this.pendingAttackTarget = targetMobId;
      if (!this.isMobApproachingUs(targetMobId)) {
        this.lastApproachSentAt = this.scene.time.now;
        const approachTile = this.findBestAdjacentTile(mobPos);
        const seq = getNextSeq();
        const payload = JSON.stringify({ target: approachTile, client_seq: seq });
        conn.socket
          .sendMatchState(matchId, Op.MOVE_REQUEST, payload)
          .catch((err) => console.warn('sendMatchState MOVE_REQUEST (approach) failed', err));
      }
    }
  }

  tick(
    conn: NakamaConnection | undefined,
    matchId: string | undefined,
    getNextSeq: () => number,
  ): void {
    if (!this.pendingAttackTarget || !conn || !matchId) return;

    const targetId = this.pendingAttackTarget;
    const mobSprite = this.entities.mobSprites.get(targetId);
    if (!mobSprite || !mobSprite.active || mobSprite.alpha <= 0) {
      this.pendingAttackTarget = null;
      return;
    }

    const mobPos = this.entities.tilePositions.get(targetId);
    if (!mobPos) {
      this.pendingAttackTarget = null;
      return;
    }

    const selfPos = this.movement.selfTilePosition;
    const manhattanDist =
      Math.abs(selfPos.x - mobPos.x) + Math.abs(selfPos.y - mobPos.y);
    const now = this.scene.time.now;

    if (manhattanDist === 1) {
      if (now - this.lastAttackRequestSentAt < 550) return;
      this.lastAttackRequestSentAt = now;
      const seq = getNextSeq();
      const payload = JSON.stringify({ target_id: targetId, client_seq: seq });
      conn.socket
        .sendMatchState(matchId, Op.ATTACK_REQUEST, payload)
        .catch((err) => console.warn('sendMatchState ATTACK_REQUEST failed', err));
      return;
    }

    if (this.isMobApproachingUs(targetId)) return;
    if (now - this.lastApproachSentAt < 500) return;

    if (this.movement.moveStates.has(this.selfUserId)) {
      const moveState = this.movement.moveStates.get(this.selfUserId);
      if (moveState && moveState.path.length > 0) {
        const pathEnd = moveState.path[moveState.path.length - 1]!;
        const endToMob =
          Math.abs(pathEnd.x - mobPos.x) + Math.abs(pathEnd.y - mobPos.y);
        if (endToMob > 1) {
          this.sendApproachRequest(conn, matchId, getNextSeq, mobPos, now);
        }
      }
    } else {
      this.sendApproachRequest(conn, matchId, getNextSeq, mobPos, now);
    }
  }

  findMobAtTile(tileX: number, tileY: number): string | null {
    for (const [entityId, pos] of this.entities.tilePositions) {
      if (!this.entities.mobSprites.has(entityId)) continue;
      if (pos.x === tileX && pos.y === tileY) {
        const sprite = this.entities.mobSprites.get(entityId);
        if (sprite && sprite.active && sprite.alpha > 0) return entityId;
      }
    }
    return null;
  }

  cancelPendingAttack(): void {
    this.pendingAttackTarget = null;
  }

  destroy(): void {
    this.pendingAttackTarget = null;
  }

  private isMobApproachingUs(mobId: string): boolean {
    const mobMoveState = this.movement.moveStates.get(mobId);
    if (!mobMoveState || mobMoveState.path.length === 0) return false;
    const mobPathEnd = mobMoveState.path[mobMoveState.path.length - 1]!;
    const selfPos = this.movement.selfTilePosition;
    return (
      Math.abs(mobPathEnd.x - selfPos.x) + Math.abs(mobPathEnd.y - selfPos.y) <= 1
    );
  }

  private sendApproachRequest(
    conn: NakamaConnection,
    matchId: string,
    getNextSeq: () => number,
    mobPos: Position,
    now: number,
  ): void {
    this.lastApproachSentAt = now;
    const approachTile = this.findBestAdjacentTile(mobPos);
    const seq = getNextSeq();
    const payload = JSON.stringify({ target: approachTile, client_seq: seq });
    conn.socket
      .sendMatchState(matchId, Op.MOVE_REQUEST, payload)
      .catch((err) => console.warn('sendMatchState MOVE_REQUEST (re-approach) failed', err));
  }

  private findBestAdjacentTile(mobPos: Position): Position {
    const selfPos = this.movement.selfTilePosition;
    const cardinalOffsets = [
      { x: 0, y: -1 },
      { x: 0, y: 1 },
      { x: -1, y: 0 },
      { x: 1, y: 0 },
    ];
    let best = { x: mobPos.x, y: mobPos.y - 1 };
    let bestDist = Infinity;
    for (const off of cardinalOffsets) {
      const tx = mobPos.x + off.x;
      const ty = mobPos.y + off.y;
      const dist = Math.abs(selfPos.x - tx) + Math.abs(selfPos.y - ty);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x: tx, y: ty };
      }
    }
    return best;
  }
}
