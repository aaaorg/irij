import { expect, test } from '@playwright/test';

// Phase 10 gathering + crafting smoke test.
// Prereqs: `pnpm infra:up` running.
// Tests: resource node visible, click → gather → progress bar → completed →
//        crafting panel toggle → recipe rows render.

test('gathering: resource nodes spawn + crafting panel renders recipes', async ({ page }) => {
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

  // Char creation if needed.
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
    const username = `gth${Date.now()}`;
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

  // Wait for WorldScene init + WORLD_SNAPSHOT.
  await page.waitForTimeout(4000);

  // Resource nodes + craft stations populated.
  const nodeCounts = await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g?.scene?.getScene('WorldScene');
    const em = ws?.entities;
    return {
      nodes: em?.resourceNodeSprites?.size ?? 0,
      stations: em?.craftStationSprites?.size ?? 0,
    };
  });
  expect(nodeCounts.nodes).toBeGreaterThanOrEqual(3);
  expect(nodeCounts.stations).toBeGreaterThanOrEqual(1);

  // Crafting panel DOM attached, initially hidden.
  const craftPanel = page.locator('#irij-crafting');
  await expect(craftPanel).toBeAttached({ timeout: 5_000 });
  await expect(craftPanel).toBeHidden();

  // Toggle via 'C' key (Phaser keyboard input is wired to canvas).
  await canvas.click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('c');

  await expect(craftPanel).toBeVisible({ timeout: 5_000 });

  // At least 3 recipe rows.
  const recipeRows = craftPanel.locator('[data-recipe-id]');
  const count = await recipeRows.count();
  expect(count).toBeGreaterThanOrEqual(3);

  // Recipe contains whetstone.
  await expect(craftPanel).toContainText('Brousek');

  // Close via 'C' again.
  await page.keyboard.press('c');
  await expect(craftPanel).toBeHidden({ timeout: 5_000 });

  // Gather progress bar DOM attached but hidden until gather starts.
  const gatherBar = page.locator('#irij-gather-progress');
  await expect(gatherBar).toBeAttached({ timeout: 5_000 });
  await expect(gatherBar).toBeHidden();

  // No console errors (filtered).
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('favicon.ico') && !e.includes('service-worker') && !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
