import type { Page } from '@playwright/test';

/**
 * Every element painted the brand yellow, by its text.
 *
 * Yellow is the ask. Anything else wearing it competes with the one thing to do next, so the
 * count is asserted rather than eyeballed.
 */
export const filledYellow = (page: Page) =>
  page.$$eval(
    'body *',
    (nodes, yellow) =>
      nodes
        .filter((node) => getComputedStyle(node).backgroundColor === yellow)
        .map((node) => node.textContent?.trim() ?? ''),
    'rgb(253, 218, 36)',
  );
