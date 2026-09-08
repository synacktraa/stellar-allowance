import { test, expect } from '@playwright/test';

// The four sizes the page has to hold at. Each gets a full-page capture in e2e/shots/.
const sizes = {
  phone: [390, 844],
  tablet: [768, 1024],
  laptop: [1366, 768],
  desktop: [1920, 1080],
} as const;

for (const [name, [width, height]] of Object.entries(sizes)) {
  test(`the baked run holds at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Give the agent an allowance');
    await expect(page.locator('.row')).toHaveCount(8);

    const refused = page.locator('.chip.refused');
    await expect(refused).toHaveCount(2);
    await expect(refused.first()).toContainText('allowlist');
    await expect(refused.last()).toContainText('window');

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'the page must not scroll sideways').toBe(false);

    await page.screenshot({ path: `e2e/shots/${name}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('the favicon and the link preview are served', async ({ request }) => {
  const icon = await request.get('/icon.svg');
  expect(icon.status()).toBe(200);
  expect(icon.headers()['content-type']).toContain('image/svg+xml');

  const og = await request.get('/opengraph-image');
  expect(og.status()).toBe(200);
  expect(og.headers()['content-type']).toContain('image/png');
});
