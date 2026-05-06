import { expect, test } from '@playwright/test';

// Phase 9 dialog smoke test.
// Prereqs: `pnpm infra:up` running (Postgres + Nakama).
// Tests: NPC visible in WorldScene, click → dialog opens → option click advances/closes.

test('dialog: open NPC dialog → click option → close', async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1) Navigate
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 2) Wait for LoginScene
  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  // 3) Guest login
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 40);

  // 4) Handle char creation if needed
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
    const username = `dlg${Date.now()}`;
    await page.evaluate((name: string) => {
      const g = (window as any).__irijGame;
      const cc = g.scene.getScene('CharacterCreationScene');
      cc.form = {
        username: name.slice(0, 16),
        display_name: name.slice(0, 16),
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

  // 5) Wait for WorldScene to fully init (match join, NPCs spawned via WORLD_SNAPSHOT)
  await page.waitForTimeout(4000);

  // 6) Verify NPC sprite present (kovář is at (28,25), test player spawns at (25,25))
  const hasNpc = await page.waitForFunction(
    () => {
      const g = (window as any).__irijGame;
      const ws = g?.scene?.getScene('WorldScene');
      const em = ws?.entities;
      return em?.npcSprites?.size > 0;
    },
    { timeout: 10_000 },
  );
  expect(await hasNpc.jsonValue()).toBeTruthy();

  // 7) Verify dialog panel DOM exists but hidden
  const dialogPanel = page.locator('#irij-dialog');
  await expect(dialogPanel).toBeAttached({ timeout: 5_000 });
  await expect(dialogPanel).toBeHidden();

  // 8) Trigger INTERACT_NPC programmatically (click projection through Phaser
  //    is brittle; sending the match-state directly tests server roundtrip).
  await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    // sendInteractNpc is private; use square-bracket access via the JS reflection.
    ws['sendInteractNpc']('npc.kovar_blatiny');
  });

  // 9) Dialog opens
  await expect(dialogPanel).toBeVisible({ timeout: 5_000 });
  await expect(dialogPanel.locator('#irij-dialog-speaker')).toContainText('Starý Kovář', {
    timeout: 5_000,
  });

  // 10) Options rendered — at least the 3 visible options (smalltalk, shop, exit).
  const optionButtons = dialogPanel.locator('#irij-dialog-options button');
  await expect(optionButtons).toHaveCount(3, { timeout: 5_000 });

  // 11) Click "Co máš na prodej?" option (gives whetstone, returns to root via shop_node)
  const shopBtn = optionButtons.filter({ hasText: 'Co máš na prodej' });
  await shopBtn.click();

  // 12) Dialog should advance to shop_node — text changes
  await expect(dialogPanel.locator('#irij-dialog-text')).toContainText('brusek', {
    timeout: 5_000,
  });

  // 13) Click "Sbohem" — closes dialog
  const farewell = dialogPanel.locator('#irij-dialog-options button').filter({ hasText: 'Sbohem' });
  await farewell.click();

  // 14) Dialog hidden
  await expect(dialogPanel).toBeHidden({ timeout: 5_000 });

  // 15) No console errors (filtered)
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('favicon.ico') && !e.includes('service-worker') && !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
