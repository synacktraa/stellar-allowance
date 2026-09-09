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

// Who wants this is the quote's job now. The lede's job is what goes wrong without it, because
// a reader who has not been burned yet does not feel "keep the wallet" as a benefit.
test('the lede names the failure before the fix', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.lede').first()).toContainText('can spend all of it');
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

// A copy control is an icon on the block it copies. Two blocks, two controls, no labels: the
// glyph says what it does, and a word beside every one of them is furniture.
test('both blocks carry a copy control, and neither is narrated', async ({ page }) => {
  await page.goto('/');
  const copies = page.locator('button.copy');
  await expect(copies).toHaveCount(2);

  for (const text of await copies.allInnerTexts()) expect(text.trim()).toBe('');
  await expect(copies.first()).toHaveAttribute('aria-label', /copy/i);
  await expect(copies.last()).toHaveAttribute('aria-label', /copy/i);
});

// The control belongs to the block, not to the text inside it, so scrolling the code sideways
// must not carry it off the edge.
test('the copy control holds still while the code scrolls under it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const code = page.locator('pre.code');
  const button = page.locator('.block:not(.pale) button.copy');
  const before = await button.boundingBox();

  await code.evaluate((node) => node.scrollBy({ left: 400 }));
  expect(await code.evaluate((node) => node.scrollLeft)).toBeGreaterThan(0);
  expect((await button.boundingBox())?.x).toBe(before?.x);
});

// The want is stated by people who build things, and stated loosely. The page carries one of
// those statements and then answers it with something specific.
test('the page carries the ask it answers, attributed', async ({ page }) => {
  await page.goto('/');
  const quote = page.locator('blockquote');
  await expect(quote).toContainText('an allowance, and permission to just take care of stuff');
  await expect(quote.locator('cite')).toContainText('DHH');
});

// A picture of where the money sits, because that is the whole difference and eight log rows
// do not show it.
test('the mechanism is drawn, and readable without seeing it', async ({ page }) => {
  await page.goto('/');
  const panels = page.locator('figure svg[role="img"]');
  expect(await panels.count()).toBeGreaterThan(0);

  // Every panel has to carry its own claim in words, because a drawing nobody can see is
  // decoration.
  for (const label of await panels.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('aria-label') ?? ''),
  )) {
    expect(label).toMatch(/money/i);
  }
  await expect(page.locator('figure figcaption')).not.toBeEmpty();
});

// Not a new payment protocol. The word that says so appears exactly where the proof starts.
test('the run is introduced as x402, not as something new', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.standing')).toContainText('x402');
});

test('the page says who built it', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer')).toContainText('synacktraa');
  await expect(page.locator('footer')).toContainText('Apache 2.0');
});
