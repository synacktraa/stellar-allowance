import { test, expect } from '@playwright/test';

// This browser has no Freighter. The page has to say so on the first row and stop there, at
// phone width as well as desktop, without scrolling sideways.
for (const [name, [width, height]] of Object.entries({ phone: [390, 844], desktop: [1366, 768] })) {
  test(`without Freighter the create page fails its first row plainly at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/create');

    await expect(page.locator('h1')).toContainText('Create an allowance');
    await expect(page.locator('.row')).toHaveCount(4);

    await page.getByRole('button', { name: 'Connect Freighter' }).click();

    const first = page.locator('.row').first();
    await expect(first).toHaveClass(/failed/);
    await expect(first).toContainText('Freighter is not installed');
    await expect(page.locator('.row.failed')).toHaveCount(1);
    await expect(page.locator('form')).toHaveCount(0);

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'the page must not scroll sideways').toBe(false);

    await page.screenshot({ path: `e2e/shots/create-${name}.png`, fullPage: true, animations: 'disabled' });
  });
}
