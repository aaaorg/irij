import { expect, test } from '@playwright/test';

// Phase 11 quest smoke test.
// Prereqs: `pnpm infra:up` running (Postgres + Nakama).
// Tests:
//   1. Quest log panel — toggle Q key → empty deník visible.
//   2. Open kovar dialog → quest_offer option visible (gated by quest_state=not_started).
//   3. Click quest_offer → quest_offer_node text → "Pomohu ti najít ho" → quest starts.
//   4. QUEST_PROGRESS event arrives → quest log shows synovec_kovar with step 1.
//   5. Walk to bloody amulet (38,38) → INTERACT_OBJECT → step advances to defeat_hastrman.
//
// Combat (hastrman kill) je out-of-scope smoke testu — combat RNG je pomalý a
// flaky pro automated test. Quest engine unit test (server/match/quest.test.ts)
// pokrývá kill_mob → return_to_kovar transition.

test('quest: start synovec_kovar → amulet interact → step advances', async ({ page }) => {
  test.setTimeout(120_000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1) Boot + login
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 40);

  // 2) Char creation if needed
  const sceneName = await page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      if (!g) return null;
      if (g.scene.getScene('CharacterCreationScene')?.sys?.isActive()) return 'cc';
      if (g.scene.getScene('WorldScene')?.sys?.isActive()) return 'world';
      return null;
    },
    { timeout: 20_000 },
  );

  if ((await sceneName.jsonValue()) === 'cc') {
    const username = `q${Date.now()}`.slice(0, 16);
    await page.evaluate((name: string) => {
      const g = (window as any).__irijGame;
      const cc = g.scene.getScene('CharacterCreationScene');
      cc.form = {
        username: name,
        display_name: name,
        gender: 'M',
        hair_id: 0,
        skin_tone_id: 0,
        outfit_id: 0,
      };
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

  // 3) Wait for WorldScene init + WORLD_SNAPSHOT (quest objects spawned)
  await page.waitForTimeout(4_000);

  // 4) Quest log toggle — empty initial state
  const questPanel = page.locator('#irij-quests');
  await expect(questPanel).toBeAttached({ timeout: 5_000 });
  await expect(questPanel).toBeHidden();

  await page.keyboard.press('q');
  await expect(questPanel).toBeVisible({ timeout: 3_000 });
  await expect(questPanel).toContainText('Aktivní (0)', { timeout: 3_000 });

  // close panel for visual clarity
  await page.keyboard.press('q');
  await expect(questPanel).toBeHidden();

  // 5) Click on kovář to open dialog (kovář at (27,25), spawn (25,25))
  const kovarClick = await page.evaluate(() => {
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
    if (!kovarId) return null;
    const npcPos = em.getNpcPosition(kovarId);
    const TILE_W = 64;
    const TILE_H = 32;
    const wx = (npcPos.x - npcPos.y) * (TILE_W / 2) + TILE_W / 2;
    const wy = (npcPos.x + npcPos.y) * (TILE_H / 2) + TILE_H / 2;
    const cam = ws.cameras.main;
    const sx = (wx - cam.scrollX) * cam.zoom;
    const sy = (wy - cam.scrollY) * cam.zoom;
    return { sx, sy };
  });
  expect(kovarClick).toBeTruthy();

  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).toBeTruthy();
  await page.mouse.click(canvasBox!.x + kovarClick!.sx, canvasBox!.y + kovarClick!.sy);

  // 6) Dialog opens with kovář
  const dialogPanel = page.locator('#irij-dialog');
  await expect(dialogPanel).toBeVisible({ timeout: 8_000 });
  await expect(dialogPanel.locator('#irij-dialog-speaker')).toContainText('Starý Kovář', {
    timeout: 5_000,
  });

  // 7) Click quest_offer option ("Vypadáš ustaraně...")
  const optionButtons = dialogPanel.locator('#irij-dialog-options button');
  const questOfferBtn = optionButtons.filter({ hasText: 'Vypadáš ustaraně' });
  await expect(questOfferBtn).toHaveCount(1, { timeout: 3_000 });
  await questOfferBtn.click();

  // 8) Dialog advances to polednice_quest_offer node
  await expect(dialogPanel.locator('#irij-dialog-text')).toContainText('Janek', {
    timeout: 5_000,
  });

  // 9) Click "Pomohu ti najít ho" → start_quest effect → quest starts + dialog closes
  const acceptBtn = dialogPanel.locator('#irij-dialog-options button').filter({ hasText: 'Pomohu ti najít ho' });
  await acceptBtn.click();

  // 10) Dialog hides (next: null)
  await expect(dialogPanel).toBeHidden({ timeout: 5_000 });

  // 11) QuestPanel — open and verify quest is active
  await page.keyboard.press('q');
  await expect(questPanel).toBeVisible();
  await expect(questPanel).toContainText('Synovec Starého Kováře', { timeout: 5_000 });
  await expect(questPanel).toContainText('Najdi v Bažině Černav stopu', { timeout: 3_000 });

  // close panel
  await page.keyboard.press('q');
  await expect(questPanel).toBeHidden();

  // 12) Verify amulet is rendered as quest_object on the map
  const amuletInfo = await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    const em = ws.entities;
    const ids = Array.from(em.questObjectPositions.keys()) as string[];
    return { count: ids.length, ids };
  });
  expect(amuletInfo.count).toBeGreaterThan(0);

  // 13) Programmaticky pošli MOVE_REQUEST k tile adjacent k amuletu (35,35).
  //     Amulet je daleko od spawnu (cheb 10), takže pixel-click test by trval
  //     moc dlouho. Ušetříme tím čas + obejdeme potenciální mob aggro.
  await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    const matchId = ws.matchId;
    const conn = ws.connRef;
    const seq = (ws.clientSeq || 0) + 1;
    ws.clientSeq = seq;
    const payload = JSON.stringify({ target: { x: 34, y: 35 }, client_seq: seq });
    conn.socket.sendMatchState(matchId, 1 /*MOVE_REQUEST*/, payload);
  });

  await page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      const ws = g.scene.getScene('WorldScene');
      const pos = ws.movement?.selfTilePosition;
      return pos && Math.abs(pos.x - 34) <= 1 && Math.abs(pos.y - 35) <= 1;
    },
    { timeout: 30_000 },
  );

  // 14) Click amulet sprite (programmatically via quest_object id)
  await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    const em = ws.entities;
    const ids = Array.from(em.questObjectPositions.keys()) as string[];
    const amuletId = ids[0];
    if (!amuletId) return;
    const matchId = ws.matchId;
    const conn = ws.connRef;
    const payload = JSON.stringify({ object_id: amuletId, action: 'interact' });
    conn.socket.sendMatchState(matchId, 31 /*INTERACT_OBJECT*/, payload);
  });

  // 15) Wait for QUEST_PROGRESS advanced → step is now defeat_hastrman
  await page.waitForFunction(
    () => {
      const panel = document.getElementById('irij-quests-active');
      if (!panel) return false;
      return panel.textContent?.includes('Hastrman') ?? false;
    },
    { timeout: 10_000 },
  );

  // open quest panel to verify advanced state
  await page.keyboard.press('q');
  await expect(questPanel).toContainText('Hastrman', { timeout: 5_000 });

  // 16) No console errors (filtered)
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon.ico') &&
      !e.includes('service-worker') &&
      !e.includes('workbox') &&
      !e.includes('chrome-extension'),
  );
  expect(realErrors).toEqual([]);
});
