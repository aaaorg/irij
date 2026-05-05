import { expect, test } from '@playwright/test';

// Phase 5 persistence test: move → reload → verify position persisted.
// Prereqs: `pnpm infra:up` running (Postgres + Nakama).

test('persistence: position survives page reload', async ({ page }) => {
  test.setTimeout(90_000);

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

  // 2) Wait for LoginScene
  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  // 3) Click Guest button
  const box = await canvas.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2 - 40);

  // 4) Handle character creation if needed
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
    const username = `persist${Date.now()}`;
    await page.evaluate((name: string) => {
      const g = (window as any).__irijGame;
      const ccScene = g.scene.getScene('CharacterCreationScene');
      ccScene.form = {
        username: name.slice(0, 16),
        display_name: name.slice(0, 16),
        gender: 'M',
        hair_id: 0,
        skin_tone_id: 0,
        outfit_id: 0,
      };
      ccScene.refresh();
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

  // 5) WorldScene is active — wait for match join + rendering
  await page.waitForTimeout(3000);

  // 6) Verify initial position is default spawn (25, 25)
  const initialPos = await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const profile = g.registry.get('irij.player');
    return profile?.player_state?.current_position;
  });
  expect(initialPos).toEqual({ x: 25, y: 25 });

  // 7) Click-to-move: click significantly away from center (toward bottom-right iso)
  const worldBox = await canvas.boundingBox();
  expect(worldBox).toBeTruthy();
  await page.mouse.click(
    worldBox!.x + worldBox!.width / 2 + 160,
    worldBox!.y + worldBox!.height / 2 + 80,
  );

  // 8) Wait for movement to complete (path ~5-8 tiles at 3 tps ≈ 2-3 seconds)
  await page.waitForTimeout(4000);

  // 9) Reload the page — this closes the WebSocket, triggering server-side
  //    matchLeave → savePlayersState (final flush with last_logout_at).
  //    Server persists current position to Storage before the new page loads.
  await page.reload();

  // 10) Wait for canvas + LoginScene + click Guest again (same device_id in localStorage)
  await expect(canvas).toBeVisible({ timeout: 10_000 });
  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('LoginScene')?.sys?.isActive(),
    { timeout: 10_000 },
  );

  const box2 = await canvas.boundingBox();
  expect(box2).toBeTruthy();
  await page.mouse.click(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2 - 40);

  // 11) Should go directly to WorldScene (character already exists)
  await page.waitForFunction(
    () => (window as any).__irijGame?.scene?.getScene('WorldScene')?.sys?.isActive(),
    { timeout: 20_000 },
  );
  await page.waitForTimeout(2000);

  // 12) Read persisted position from profile (loaded from Storage by profileGetSelf)
  const persistedPos = await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const profile = g.registry.get('irij.player');
    return profile?.player_state?.current_position;
  });

  expect(persistedPos).toBeDefined();
  expect(persistedPos.x !== 25 || persistedPos.y !== 25).toBeTruthy();

  // 13) Verify no console errors
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes('favicon.ico') &&
      !e.includes('service-worker') &&
      !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
