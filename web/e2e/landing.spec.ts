import { test, expect } from '@playwright/test';
import { filledYellow } from './palette';

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

test('the lede says who the page is for', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lede')).toContainText('agent that calls paid APIs');
});

test('one filled yellow block, and it is the ask', async ({ page }) => {
  await page.goto('/');
  expect(await filledYellow(page)).toEqual(['Run it live']);
});

test('the package is on the page, install line and all', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.install')).toContainText('npm i @stellar-allowance/sdk');
  await expect(page.locator('pre.code')).toContainText('new Allowance()');
});

test('code blocks scroll sideways rather than wrapping', async ({ page }) => {
  await page.goto('/');
  const style = await page
    .locator('pre.code')
    .evaluate((node) => [getComputedStyle(node).whiteSpace, getComputedStyle(node).overflowX]);
  expect(style).toEqual(['pre', 'auto']);
});

test('each step announces its own state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.run .state[aria-live="polite"]')).toHaveCount(8);
});
