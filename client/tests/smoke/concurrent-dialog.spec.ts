import { expect, test } from '@playwright/test';

// Diagnose Phase 9 concurrency bug: when player A talks to kovář, player B's
// click on kovář from far away navigates but never opens dialog.
//
// Scenario:
//   1. Login A → click kovář from far → A dialog opens
//   2. Login B (separate context) → click kovář from far → B dialog should open

async function loginAndJoinWorld(context: import('@playwright/test').BrowserContext, label: string) {
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.log(`[${label} ${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  const box = await canvas.boundingBox();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 40);

  const sceneName = await page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      if (g?.scene?.getScene('CharacterCreationScene')?.sys?.isActive()) return 'cc';
      if (g?.scene?.getScene('WorldScene')?.sys?.isActive()) return 'world';
      return null;
    },
    { timeout: 20_000 },
  );

  if ((await sceneName.jsonValue()) === 'cc') {
    const username = `${label}${Date.now()}`.slice(0, 16);
    await page.evaluate((name: string) => {
      const g = (window as any).__irijGame;
      const cc = g.scene.getScene('CharacterCreationScene');
      cc.form = { username: name, display_name: name, gender: 'M', hair_id: 0, skin_tone_id: 0, outfit_id: 0 };
      cc.refresh();
    }, username);
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    });
    await page.waitForFunction(
      () => (window as any).__irijGame?.scene?.getScene('WorldScene')?.sys?.isActive(),
      { timeout: 20_000 },
    );
  }

  // Wait for NPCs to spawn via WORLD_SNAPSHOT
  await page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      const ws = g?.scene?.getScene('WorldScene');
      return ws?.entities?.npcSprites?.size > 0;
    },
    { timeout: 10_000 },
  );

  return { page, canvas };
}

async function clickKovarFromFar(page: import('@playwright/test').Page, canvas: import('@playwright/test').Locator) {
  const npcWorldClick = await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    const em = ws.entities;
    let kovarId: string | null = null;
    for (const [id, sprite] of em.npcSprites.entries()) {
      if (sprite.getData('npcId') === 'npc.kovar_blatiny') {
        kovarId = id as string;
        break;
      }
    }
    const npcPos = em.getNpcPosition(kovarId!);
    const TILE_W = 64;
    const TILE_H = 32;
    const wx = (npcPos.x - npcPos.y) * (TILE_W / 2) + TILE_W / 2;
    const wy = (npcPos.x + npcPos.y) * (TILE_H / 2) + TILE_H / 2;
    const cam = ws.cameras.main;
    const sx = (wx - cam.scrollX) * cam.zoom;
    const sy = (wy - cam.scrollY) * cam.zoom;
    return { sx, sy, npcId: kovarId, npcPos };
  });

  const canvasBox = await canvas.boundingBox();
  await page.mouse.click(canvasBox!.x + npcWorldClick.sx, canvasBox!.y + npcWorldClick.sy);
}

test('concurrent dialog: A talks to kovář, B navigates to kovář, B dialog opens', async ({ browser }) => {
  test.setTimeout(120_000);

  const ctxA = await browser.newContext({ storageState: undefined });
  const ctxB = await browser.newContext({ storageState: undefined });

  const A = await loginAndJoinWorld(ctxA, 'A');
  const B = await loginAndJoinWorld(ctxB, 'B');

  // Wait for both to be settled
  await A.page.waitForTimeout(2000);
  await B.page.waitForTimeout(2000);

  // Capture B's network sends so we can see what's happening
  await B.page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    (window as any).__sentMessages = [];
    const sock = ws.connRef.socket;
    const orig = sock.sendMatchState.bind(sock);
    sock.sendMatchState = (matchId: string, op: number, data: string) => {
      (window as any).__sentMessages.push({ op, data });
      console.log(`[B send] op=${op} data=${data}`);
      return orig(matchId, op, data);
    };
  });

  // Capture B's received messages
  await B.page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    (window as any).__recvMessages = [];
    const sock = ws.connRef.socket;
    const origHandler = sock.onmatchdata;
    sock.onmatchdata = (md: any) => {
      const text = typeof md.data === 'string' ? md.data : new TextDecoder().decode(md.data);
      (window as any).__recvMessages.push({ op: md.op_code, data: text });
      console.log(`[B recv] op=${md.op_code} data=${text.slice(0, 200)}`);
      return origHandler(md);
    };
  });

  // 1) A clicks kovář from far → walks → dialog opens
  await clickKovarFromFar(A.page, A.canvas);
  const dialogA = A.page.locator('#irij-dialog');
  await expect(dialogA).toBeVisible({ timeout: 8_000 });
  console.log('A dialog opened ✓');

  // 2a) B walks far away first (spawn (25,25) is Cheb=2 from kovář, so default
  //     handleNpcClick takes the "close" path. Force the "far" path by walking
  //     B to (20,20) first.
  await B.page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    const seq = ws['nextSeq']();
    ws.connRef.socket.sendMatchState(
      ws.matchId,
      1, // MOVE_REQUEST opcode
      JSON.stringify({ target: { x: 20, y: 20 }, client_seq: seq }),
    );
  });
  // Wait for B to actually arrive at (20,20)
  await B.page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      const ws = g.scene.getScene('WorldScene');
      const p = ws.movement.selfTilePosition;
      return Math.abs(p.x - 20) <= 1 && Math.abs(p.y - 20) <= 1;
    },
    { timeout: 10_000 },
  );
  console.log('B arrived at far position ✓');
  await B.page.waitForTimeout(500);

  // 2b) B clicks kovář from far → walks → expect dialog
  await clickKovarFromFar(B.page, B.canvas);

  // Wait for B to walk to kovář
  await B.page.waitForTimeout(5_000);

  const dialogB = B.page.locator('#irij-dialog');
  const isVisible = await dialogB.isVisible();

  if (!isVisible) {
    // Dump B's state for debugging
    const debug = await B.page.evaluate(() => {
      const g = (window as any).__irijGame;
      const ws = g.scene.getScene('WorldScene');
      const em = ws.entities;
      let kovarId: string | null = null;
      let kovarPos: any = null;
      for (const [id, sprite] of em.npcSprites.entries()) {
        if (sprite.getData('npcId') === 'npc.kovar_blatiny') {
          kovarId = id as string;
          kovarPos = em.getNpcPosition(id);
          break;
        }
      }
      return {
        selfPos: ws.movement.selfTilePosition,
        kovarPos,
        kovarId,
        pendingNpcInteract: ws.pendingNpcInteract,
        moveStates: Array.from(ws.movement.moveStates.keys()),
        sentMessages: (window as any).__sentMessages,
        recvMessages: (window as any).__recvMessages,
        dialogVisible: ws.dialogPanel?.isVisible() ?? null,
      };
    });
    console.log('B debug state after click+wait:', JSON.stringify(debug, null, 2));
  }

  await expect(dialogB).toBeVisible({ timeout: 8_000 });

  await ctxA.close();
  await ctxB.close();
});
