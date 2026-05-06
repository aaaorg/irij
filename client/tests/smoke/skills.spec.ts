import { expect, test } from '@playwright/test';

// Phase 8 skills smoke test.
// Prereqs: `pnpm infra:up` running (Postgres + Nakama).
// Tests: skill panel toggle, render všech 17 skillů + 4 atributů, XP bary,
// XP_AWARDED → state update přes simulovanou aplikaci payloadu.

test('skills UI: panel toggle, all rows render, XP_AWARDED applies', async ({ page }) => {
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
    const username = `sk${Date.now()}`;
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

  // 5) Wait for WorldScene init
  await page.waitForTimeout(4000);

  // 6) Skill panel exists, hidden by default
  const skPanel = page.locator('#irij-skills');
  await expect(skPanel).toBeAttached({ timeout: 5_000 });
  await expect(skPanel).toBeHidden();

  // 7) Press [K] → panel opens
  await page.keyboard.press('k');
  await expect(skPanel).toBeVisible({ timeout: 2_000 });

  // 8) Verify Atributy + Skilly headings
  await expect(skPanel.locator('#irij-skills-atributy')).toContainText('Atributy');
  await expect(skPanel.locator('#irij-skills-skilly')).toContainText('Skilly');

  // 9) Atributy section has all 4 atributy labels
  const atrSec = skPanel.locator('#irij-skills-atributy');
  for (const label of ['Síla', 'Obratnost', 'Inteligence', 'Životy']) {
    await expect(atrSec).toContainText(label);
  }

  // 10) Skilly section has key skill labels
  const skSec = skPanel.locator('#irij-skills-skilly');
  for (const label of ['Boj zblízka', 'Lukostřelba', 'Kovářství', 'Modlitba']) {
    await expect(skSec).toContainText(label);
  }

  // 11) Verify Total label in header (initial = 21 = 4 atributy lvl 1 + 17 skilly lvl 1)
  await expect(skPanel.locator('#irij-skills-title')).toContainText('Total: 21');

  // 12) Simulate XP_AWARDED: melee +200 → expect skill level rises ≥ 2 + total > 21
  await page.evaluate(() => {
    const g = (window as any).__irijGame;
    const ws = g.scene.getScene('WorldScene');
    ws.handleXpAwarded({
      source: 'mob_kill',
      gains: [
        { type: 'skill', name: 'melee', amount: 200, base_amount: 200, level_before: 1, level_after: 3 },
      ],
      total_xp_delta: 200,
      total_level_delta: 2,
    });
  });

  await expect(skPanel.locator('#irij-skills-title')).toContainText('Total: 23');
  await expect(skSec).toContainText('Boj zblízka');

  // 13) Press [K] again → close
  await page.keyboard.press('k');
  await expect(skPanel).toBeHidden({ timeout: 2_000 });

  // 14) No console errors
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('favicon.ico') && !e.includes('service-worker') && !e.includes('workbox'),
  );
  expect(realErrors).toEqual([]);
});
