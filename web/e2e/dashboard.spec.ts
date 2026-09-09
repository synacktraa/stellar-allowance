import { test, expect } from '@playwright/test';

// An owner from a real testnet run. Reads are public, so the board renders without a wallet.
// These allowances archive seven days after their last payment, so the assertions below are
// about shape rather than about any particular name or figure.
const OWNER = 'GDMZZTTZHDUMLPWC5AQLAKZZCPZRZGZCJ4QVM4O3VZLRO6EGTDZJSJLT';

const sizes = {
  phone: [390, 844],
  tablet: [768, 1024],
  laptop: [1366, 768],
} as const;

test('without a wallet the dashboard asks for one and nothing else', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Your allowances' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeEnabled();
  await expect(page.locator('table')).toHaveCount(0);

  await page.getByRole('button', { name: 'Connect Freighter' }).click();
  await expect(page.locator('.bad')).toContainText('Freighter is not installed');

  await page.screenshot({ path: 'e2e/shots/dash-connect.png', fullPage: true, animations: 'disabled' });
});

for (const [name, [width, height]] of Object.entries(sizes)) {
  test(`the board holds at ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(`/dashboard?owner=${OWNER}`);

    await expect(page.locator('tbody tr')).not.toHaveCount(0, { timeout: 30_000 });
    await expect(page.locator('.warn.banner')).toContainText('public on chain');
    await expect(page.getByRole('button', { name: 'New allowance' })).toBeDisabled();

    const overflows = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows, 'the board must not scroll sideways').toBe(false);

    await page.screenshot({ path: `e2e/shots/dash-${name}.png`, fullPage: true, animations: 'disabled' });
  });
}

test('a row opens a panel carrying the two values and the four lines', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto(`/dashboard?owner=${OWNER}`);

  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('tbody tr').first().click();

  const panel = page.locator('aside.panel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.code.env')).toContainText('STELLAR_ALLOWANCE_ID');
  await expect(panel.locator('.code.env')).toContainText('shown once');
  await expect(panel.locator('.code').last()).toContainText('new Allowance()');
  await expect(panel.getByRole('button', { name: 'Save' })).toBeDisabled();
  await expect(panel).toContainText('Connect this wallet to change anything');

  await page.screenshot({ path: 'e2e/shots/dash-panel.png' });
});
