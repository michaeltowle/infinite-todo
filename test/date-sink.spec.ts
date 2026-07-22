// Date sink: a todo's date is no longer left in the text as a #tag — it is STORED. Typing a date
// tag and blurring the line "sinks" it: optparse extracts the date into the stored `date` field
// and the tag is stripped out of keyboardText for good, so it stops cluttering the line and never
// re-appears when the line is focused again. These specs drive the real page and read the Durable
// Object where the claim is about what was stored.

import { test, expect } from '@playwright/test';
import { layTree, node, plan, open, nodeById } from './helpers.ts';

// The local calendar day as YYYY-MM-DD, the way the client computes "today".
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 2026-07-22
// Blurring a line that carries a valid date tag sinks it: the DO ends with the tag stripped from
// keyboardText and the date in the stored field; the tag does not come back when the line is
// re-focused; and because the date is now known, the todo shows in the today-box.
test('blurring a line with a date tag sinks the date and strips the tag', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  const ta = page.locator('textarea[data-id="a"]');
  await ta.click();
  await page.keyboard.type('buy milk #' + today());
  await page.locator('#plan-page h1').click(); // blur the todo by focusing the title

  // Stored: tag gone from the text, date captured in its own field.
  await expect.poll(async () => (await nodeById(request, 'a'))?.keyboardText).toBe('buy milk');
  expect((await nodeById(request, 'a'))?.date).toBe(today());

  // Visible: the tag is gone and stays gone when the line is focused for editing again.
  await expect(ta).toHaveValue('buy milk');
  await ta.click();
  await expect(ta).toHaveValue('buy milk');

  // The sunk date drives the today-box.
  await expect(page.locator('#today-box')).toContainText('buy milk');
});

// 2026-07-22
// A sunk date is durable: after a full reload the tag is still gone from the text and the date
// still places the todo in today — proving the sink reached the store, not just the local mirror.
test('a sunk date survives a reload', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  const ta = page.locator('textarea[data-id="a"]');
  await ta.click();
  await page.keyboard.type('call vet #' + today());
  await page.locator('#plan-page h1').click();
  await expect.poll(async () => (await nodeById(request, 'a'))?.date).toBe(today());

  await page.reload();
  await expect(page.locator('.todo-row')).toHaveCount(1);
  await expect(page.locator('textarea[data-id="a"]')).toHaveValue('call vet');
  await expect(page.locator('#today-box')).toContainText('call vet');
});

// 2026-07-22
// Only real date tags are sunk. A '#' token that is not a date (no trailing day number) is left in
// the text on blur and stores no date — nothing is extracted, nothing is stripped.
test('a non-date hashtag is left in the text on blur', async ({ page, request }) => {
  await layTree(request, [node('a', null, 1, false, '', 'p-work')], [plan('p-work', 'Work', 1)]);
  await open(page, 1);

  const ta = page.locator('textarea[data-id="a"]');
  await ta.click();
  await page.keyboard.type('grab #groceries');
  await page.locator('#plan-page h1').click();

  await expect.poll(async () => (await nodeById(request, 'a'))?.keyboardText).toBe('grab #groceries');
  expect((await nodeById(request, 'a'))?.date ?? null).toBeNull();
  await ta.click();
  await expect(ta).toHaveValue('grab #groceries');
});
