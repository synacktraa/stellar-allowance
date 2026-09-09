import { test, expect } from '@playwright/test';
import { filledYellow } from './palette';

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

// Freighter's isConnected waits on a reply from an extension that is not installed and burns
// its own timeout, close to 3s. The button must not wait with it: every first visit is a first
// visit without the extension.
test('the connect button is live before the wallet check comes back', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeEnabled({
    timeout: 1000,
  });
});

test('the connect screen wears one filled yellow block', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('button', { name: 'Connect Freighter' })).toBeVisible();
  expect(await filledYellow(page)).toEqual(['Connect Freighter']);
});

// A table that appears out of an empty card moves everything under it. Lines of the right
// height stand in until the two reads land, so nothing jumps when they do.
test('placeholder lines hold the table while the chain is read', async ({ page }) => {
  await page.route('**/soroban-testnet.stellar.org/**', async (route) => {
    await new Promise((settle) => setTimeout(settle, 4000));
    await route.continue();
  });

  await page.goto(`/dashboard?owner=${OWNER}`);
  await expect(page.locator('tbody tr.skeleton')).toHaveCount(5);
  // Not "0 of 60": nothing is known about the count until the read lands.
  await expect(page.locator('.board .cap')).toHaveCount(0);
  await page.screenshot({ path: 'e2e/shots/dash-waiting.png', animations: 'disabled' });

  await expect(page.locator('tbody tr.line').first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('tbody tr.skeleton')).toHaveCount(0);
});

// Sixty is how far the index probe reaches, not a budget the owner was given. It belongs where
// it binds - the button that can no longer be pressed - and nowhere else.
test('the count is what the owner has, not a ceiling', async ({ page }) => {
  await page.goto(`/dashboard?owner=${OWNER}`);
  const rows = page.locator('tbody tr.line');
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });

  // The table is the count, and the foot reports totals once there is more than one page.
  await expect(page.locator('.board .head')).toHaveText('Allowances');
});

test('the panel is a dialog, and Escape closes it', async ({ page }) => {
  await page.goto(`/dashboard?owner=${OWNER}`);
  const first = page.locator('tbody tr.line').first();
  await expect(first).toBeVisible({ timeout: 30_000 });
  await first.click();

  const panel = page.getByRole('dialog');
  await expect(panel).toBeVisible();
  await expect(panel).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(first).toBeFocused();
});

test('the two values scroll sideways rather than wrapping', async ({ page }) => {
  await page.goto(`/dashboard?owner=${OWNER}`);
  await expect(page.locator('tbody tr.line').first()).toBeVisible({ timeout: 30_000 });
  await page.locator('tbody tr.line').first().click();

  const style = await page
    .locator('.code.env')
    .evaluate((node) => [getComputedStyle(node).whiteSpace, getComputedStyle(node).overflowX]);
  expect(style).toEqual(['pre', 'auto']);

  // Read-only, so the secret is not on screen and the pair is not worth copying. The four lines
  // are, and their control is an icon like every other.
  const copies = page.locator('aside.panel button.copy');
  await expect(copies).toHaveCount(1);
  await expect(copies).toHaveAttribute('aria-label', /copy/i);
  expect((await copies.allInnerTexts()).join('').trim()).toBe('');
});
