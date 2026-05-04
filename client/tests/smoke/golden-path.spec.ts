import { expect, test } from '@playwright/test';

// Golden path smoke test — BootScene → guest auth → char create → world → move.
// Předpoklady: `pnpm infra:up` běží (Postgres + Nakama).
// Fresh browser context = čistý localStorage = nový guest account.

test('golden path: boot → login → create character → world → click-to-move', async ({
  page,
}) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  // 1) Navigate and wait for Phaser canvas
  await page.goto('/');
  const canvas = page.locator('canvas');
  await expect(canvas).toBeVisible({ timeout: 10_000 });

  // 2) Wait for LoginScene to be active
  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  // 3) Click the Guest button — at (cx, cy - 40) in canvas coords
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(
    box!.x + box!.width / 2,
    box!.y + box!.height / 2 - 40,
  );

  // 4) Wait for CharacterCreation or World scene
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

  const scene = await sceneName.jsonValue();

  if (scene === 'cc') {
    // 5) Create character via direct game API (bypassing keyboard for reliability)
    const username = `smoke${Date.now()}`;
    await page.evaluate(
      (name: string) => {
        const g = (window as any).__irijGame;
        const ccScene = g.scene.getScene('CharacterCreationScene');
        // Set form state directly on the scene instance
        ccScene.form = {
          username: name.slice(0, 16),
          display_name: name.slice(0, 16),
          gender: 'M',
          hair_id: 0,
          skin_tone_id: 0,
          outfit_id: 0,
        };
        ccScene.refresh();
      },
      username,
    );

    // Trigger submit by dispatching Enter key to the window
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
    });

    // 6) Wait for WorldScene
    await page.waitForFunction(
      () => (window as any).__irijGame?.scene?.getScene('WorldScene')?.sys?.isActive(),
      { timeout: 20_000 },
    );
  }

  // 7) World scene is active — verify canvas still visible
  await expect(canvas).toBeVisible();

  // 8) Wait for map to load (WorldScene.preload → create → match join)
  await page.waitForTimeout(3000);

  // 9) Click-to-move: click offset from center
  const worldBox = await canvas.boundingBox();
  expect(worldBox).toBeTruthy();
  await page.mouse.click(
    worldBox!.x + worldBox!.width / 2 + 100,
    worldBox!.y + worldBox!.height / 2 + 50,
  );

  // 10) Brief wait for movement to process
  await page.waitForTimeout(1500);

  // 11) Verify no console errors (filtered)
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon.ico') &&
      !e.includes('service-worker') &&
      !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
