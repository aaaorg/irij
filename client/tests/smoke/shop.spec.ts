import { expect, test } from '@playwright/test';

// Phase 13 — NPC merchant shop smoke test.
// Prereqs: `pnpm infra:up` running with up-to-date `pnpm build:server`.
// Verifies:
//   1. Kovář dialog má novou option „Ukaž mi, co kováš." (open_shop effect).
//   2. Klik na option zavře dialog a otevře ShopPanel s NPC stockem (sell column)
//      a buy column. Specialist Kovář kupuje ironovou rudu za 18 d.
//   3. Žádné console errors.

test('shop: kovář dialog → open shop → ShopPanel renders sell + buy columns', async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

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
    const username = `sh${Date.now()}`.slice(0, 16);
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
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      );
    });
    await page.waitForFunction(
      () => (window as any).__irijGame?.scene?.getScene('WorldScene')?.sys?.isActive(),
      { timeout: 20_000 },
    );
  }

  // Wait for WorldScene + match join + NPCs spawn.
  await page.waitForTimeout(4000);

  // Click Kovář NPC.
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
    if (!kovarId) throw new Error('Kovář not spawned');
    const npcPos = em.getNpcPosition(kovarId);
    const TILE_W = 64;
    const TILE_H = 32;
    const wx = (npcPos.x - npcPos.y) * (TILE_W / 2) + TILE_W / 2;
    const wy = (npcPos.x + npcPos.y) * (TILE_H / 2) + TILE_H / 2;
    const cam = ws.cameras.main;
    return {
      sx: (wx - cam.scrollX) * cam.zoom,
      sy: (wy - cam.scrollY) * cam.zoom,
    };
  });

  const cb = await canvas.boundingBox();
  await page.mouse.click(cb!.x + kovarClick.sx, cb!.y + kovarClick.sy);

  // Dialog opens.
  const dialogPanel = page.locator('#irij-dialog');
  await expect(dialogPanel).toBeVisible({ timeout: 8_000 });

  // Click „Ukaž mi, co kováš." → open_shop effect.
  await dialogPanel
    .locator('#irij-dialog-options button')
    .filter({ hasText: /Ukaž mi/i })
    .click();

  // Dialog hidden, shop panel visible.
  await expect(dialogPanel).toBeHidden({ timeout: 5_000 });
  const shopPanel = page.locator('#irij-shop');
  await expect(shopPanel).toBeVisible({ timeout: 5_000 });

  // Title obsahuje jméno NPC.
  await expect(shopPanel.locator('#irij-shop-title')).toContainText('Starý Kovář', {
    timeout: 3_000,
  });

  // Sell sloupec má alespoň jeden item.
  await expect(shopPanel).toContainText('Bronzový meč', { timeout: 3_000 });
  await expect(shopPanel).toContainText('120 d', { timeout: 3_000 });

  // Buy sloupec má železnou rudu za 18 d (specialist price).
  await expect(shopPanel).toContainText('Železná ruda', { timeout: 3_000 });
  await expect(shopPanel).toContainText('18 d', { timeout: 3_000 });

  // Close button works.
  await shopPanel.locator('button').filter({ hasText: '✕' }).click();
  await expect(shopPanel).toBeHidden({ timeout: 3_000 });

  // No console errors.
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon.ico') &&
      !e.includes('service-worker') &&
      !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
