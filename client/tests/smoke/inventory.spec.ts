import { expect, test } from '@playwright/test';

// Phase 7 inventory smoke test.
// Prereqs: `pnpm infra:up` running (Postgres + Nakama).
// Tests: inventory/equipment panel open+close, item render via state injection, Equipovat button.

test('inventory UI: panels open, item renders, Equipovat button visible', async ({ page }) => {
  test.setTimeout(60_000);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  // 1) Navigate to game
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
    const username = `inv${Date.now()}`;
    await page.evaluate((name: string) => {
      const g = (window as any).__irijGame;
      const cc = g.scene.getScene('CharacterCreationScene');
      cc.form = { username: name.slice(0, 16), display_name: name.slice(0, 16), gender: 'M', hair_id: 0, skin_tone_id: 0, outfit_id: 0 };
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

  // 5) Wait for WorldScene to fully initialize (match join + inventory load)
  await page.waitForTimeout(4000);

  // 6) Verify inventory panel DOM element exists but is hidden initially
  const invPanel = page.locator('#irij-inventory');
  await expect(invPanel).toBeAttached({ timeout: 5_000 });
  await expect(invPanel).toBeHidden();

  // 7) Press [I] — inventory + equipment panels should open
  await page.keyboard.press('i');
  await expect(invPanel).toBeVisible({ timeout: 2_000 });

  const equipPanel = page.locator('#irij-equipment');
  await expect(equipPanel).toBeAttached({ timeout: 2_000 });
  await expect(equipPanel).toBeVisible({ timeout: 2_000 });

  // 8) Press [I] again — both panels close
  await page.keyboard.press('i');
  await expect(invPanel).toBeHidden({ timeout: 2_000 });
  await expect(equipPanel).toBeHidden({ timeout: 2_000 });

  // 9) Inject a dagger into inventory state via WorldScene (bypasses server — tests UI layer only)
  await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    if (!ws?.inventoryPanel) return;
    ws.inventoryPanel.update([
      { slot_index: 0, item_id: 'weapon.melee.dagger.bronze', quantity: 1 },
      ...Array.from({ length: 23 }, (_, i) => ({ slot_index: i + 1, item_id: null, quantity: 0 })),
    ]);
  });

  // 10) Open inventory — injected item should render
  await page.keyboard.press('i');
  await expect(invPanel).toBeVisible();

  // 11) Click first grid slot (contains dagger) — info section should show item name
  const firstSlot = invPanel.locator('#irij-inv-grid div').first();
  await expect(firstSlot).toBeVisible({ timeout: 2_000 });
  await firstSlot.click();

  const infoEl = invPanel.locator('#irij-inv-info');
  await expect(infoEl).toContainText('Bronzová dýka', { timeout: 2_000 });

  // 12) Verify Equipovat button appears (dagger is equipable)
  const actionsEl = invPanel.locator('#irij-inv-actions');
  const equipBtn = actionsEl.getByText('Equipovat');
  await expect(equipBtn).toBeVisible({ timeout: 2_000 });

  // 13) Verify Zahodit button also appears
  await expect(actionsEl.getByText('Zahodit')).toBeVisible();

  // 14) Equipment panel shows all slot rows
  const slotRows = equipPanel.locator('#irij-equip-slots div');
  await expect(slotRows).toHaveCount(11, { timeout: 2_000 }); // 11 equipment slots

  // 15) No console errors
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('favicon.ico') && !e.includes('service-worker') && !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
