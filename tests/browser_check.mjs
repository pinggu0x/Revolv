// Optional browser verification; Playwright is a test tool, not an app dependency.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require = createRequire(import.meta.url);
const {chromium} = require(process.env.REVOLV_PLAYWRIGHT_PATH || 'playwright');
const origin = process.env.REVOLV_URL || 'http://127.0.0.1:8000';
const key = 'revolv.browser.v1';
const profile = await mkdtemp(join(tmpdir(), 'revolv-browser-check-'));
const errors = [], externalRequests = [];
let context;
const content = `## MODULE 1
### Biology
#flashcards
**The basic unit of life** <u>&nbsp;&nbsp;&nbsp;</u> &amp; <img src="https://invalid.test/image" onerror="window.injected=true">
?
Cell

---
Which structure stores genetic information?
- [ ] Ribosome
- [x] Nucleus
- [ ] Cell membrane
?
The nucleus contains the cell’s DNA.

---
Select the prime numbers.
- [x] 2
- [x] 3
- [ ] 4
?
Both 2 and 3 have exactly two factors.
`;
const payload = text => ({name: 'biology.md', mimeType: 'text/markdown', buffer: Buffer.from(text)});
async function eventually(check) {
  const deadline = Date.now() + 5000;
  while (true) {
    try { await check(); return; }
    catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}
function expect(locator) {
  return {
    toHaveText: text => eventually(async () => assert.equal(await locator.textContent(), text)),
    toContainText: text => eventually(async () => assert.ok((await locator.textContent()).includes(text))),
    toBeVisible: () => eventually(async () => assert.equal(await locator.isVisible(), true)),
    toBeEnabled: () => eventually(async () => assert.equal(await locator.isEnabled(), true)),
    toBeDisabled: () => eventually(async () => assert.equal(await locator.isDisabled(), true)),
    toBeChecked: () => eventually(async () => assert.equal(await locator.isChecked(), true)),
    toHaveAttribute: (name, value) => eventually(async () => assert.equal(await locator.getAttribute(name), value)),
    not: {toBeVisible: () => eventually(async () => assert.equal(await locator.isVisible(), false))},
  };
}
expect.poll = read => ({toBe: value => eventually(async () => assert.equal(await read(), value))});
async function launch() {
  context = await chromium.launchPersistentContext(profile, {headless: true, viewport: {width: 1440, height: 1000}});
  context.on('page', page => monitor(page));
  for (const page of context.pages()) monitor(page);
  return context.pages()[0];
}
function monitor(page) {
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', request => { if (!request.url().startsWith(origin) && !request.url().startsWith('blob:')) externalRequests.push(request.url()); });
}
const saved = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), key);
async function click(page, action) { await page.locator(`[data-action="${action}"]:visible`).first().click(); }
async function confirm(page) { await page.locator('#dialog [data-action="confirm"]').click(); await expect(page.locator('#dialog')).not.toBeVisible(); }
async function noOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Horizontal overflow at ${(await page.viewportSize()).width}px`);
}

try {
  let page = await launch();
  await page.goto(origin);
  await expect(page.locator('h1')).toHaveText('Make room for recall.');
  await page.locator('#deck-file').setInputFiles(payload(content));
  await expect(page.locator('.deck-card h3')).toHaveText('Biology');
  assert.equal((await saved(page)).decks[0].cards.length, 3);
  for (const width of [320, 360, 390, 680, 768, 1024, 1440]) {
    await page.setViewportSize({width, height: 900}); await noOverflow(page);
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.screenshot({path: join(tmpdir(), 'revolv-library-populated.png'), fullPage: true});
  await click(page, 'study');
  await expect(page.locator('#question')).toContainText('____________ &');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#question')).toHaveText('Which structure stores genetic information?');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#question')).toContainText('____________ &');
  assert.equal(await page.locator('.flashcard img').count(), 0);
  assert.equal(await page.evaluate(() => !!window.injected), false);
  await page.keyboard.press('Space');
  await expect(page.locator('.answer-text')).toHaveText('Cell');
  const beforeHide = await saved(page);
  await click(page, 'hide-answer');
  await expect(page.locator('.answer-area')).not.toBeVisible();
  await expect(page.locator('.rating-grid')).not.toBeVisible();
  await page.reload();
  await expect(page.locator('.answer-area')).not.toBeVisible();
  assert.deepEqual((await saved(page)).stats, beforeHide.stats);
  assert.deepEqual((await saved(page)).decks[0].cards, beforeHide.decks[0].cards);
  await page.locator('#main').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('.answer-text')).toHaveText('Cell');
  await page.keyboard.press('Space');
  await expect(page.locator('.answer-area')).not.toBeVisible();
  await page.keyboard.press('3');
  assert.deepEqual((await saved(page)).stats, beforeHide.stats);
  await page.keyboard.press('Space');
  await expect(page.locator('.answer-text')).toHaveText('Cell');
  await page.keyboard.press('3');
  await expect(page.locator('#question')).toHaveText('Which structure stores genetic information?');
  assert.equal((await saved(page)).decks[0].cards[0].interval, 3);
  await expect(page.locator('[data-action="reveal"]')).toBeDisabled();
  await page.locator('input[value="0"]').check();
  await expect(page.locator('[data-action="reveal"]')).toBeEnabled();
  await click(page, 'reveal');
  await expect(page.locator('.choice-feedback')).toContainText('Not quite.');
  await click(page, 'hide-answer');
  await expect(page.locator('.choice-feedback')).not.toBeVisible();
  await expect(page.locator('.choice.correct')).not.toBeVisible();
  await expect(page.locator('input[value="0"]')).toBeDisabled();
  await page.reload();
  await expect(page.locator('.choice-feedback')).not.toBeVisible();
  await click(page, 'reveal');
  await expect(page.locator('.choice-feedback')).toContainText('Not quite.');
  assert.equal((await saved(page)).stats.choice_attempts, 1);
  await page.reload();
  await expect(page.locator('.choice-feedback')).toContainText('Not quite.');
  assert.equal((await saved(page)).stats.choice_attempts, 1);
  await click(page, 'rate'); // Hard is first in the rating grid.
  await expect(page.locator('#question')).toHaveText('Select the prime numbers.');
  assert.equal(await page.locator('input[type="checkbox"]').count(), 3);
  await page.locator('input[value="0"]').check();
  await page.locator('input[value="1"]').check();
  await page.setViewportSize({width: 390, height: 844});
  await noOverflow(page);
  await page.screenshot({path: join(tmpdir(), 'revolv-study-mobile.png'), fullPage: true});
  await expect.poll(async () => (await saved(page)).decks[0].session.selected.length).toBe(2);
  await context.close();
  page = await launch();
  await page.goto(origin);
  await expect(page.locator('#question')).toHaveText('Select the prime numbers.');
  await expect(page.locator('input[value="0"]')).toBeChecked();
  await expect(page.locator('input[value="1"]')).toBeChecked();
  await click(page, 'reveal');
  await expect(page.locator('.choice-feedback')).toContainText('That’s correct.');
  await page.keyboard.press('2');
  await expect(page.locator('#question')).toHaveText('Which structure stores genetic information?');
  await page.locator('input[value="1"]').check();
  await click(page, 'reveal');
  await expect(page.locator('.choice-feedback')).toContainText('That’s correct.');
  await page.keyboard.press('3');
  await expect(page.locator('h1')).toHaveText('All caught up.');
  let snapshot = await saved(page);
  assert.equal(snapshot.stats.total_cards_reviewed, 4);
  assert.equal(snapshot.stats.choice_attempts, 3);
  assert.equal(snapshot.stats.choice_correct, 2);
  assert.equal(snapshot.stats.study_sessions, 1);
  await click(page, 'library');

  // Backup round trip, deck removal/reimport and progress reset.
  const downloadEvent = page.waitForEvent('download');
  await click(page, 'backup');
  const download = await downloadEvent;
  const backupPath = await download.path();
  await page.locator('.deck-menu summary').click(); await click(page, 'update-deck');
  await page.locator('#deck-file').setInputFiles(payload(content.replace('\nCell\n', '\nLiving cell\n')));
  await confirm(page);
  assert.equal((await saved(page)).decks[0].cards[0].answer, 'Living cell');
  assert.equal((await saved(page)).decks[0].cards[0].interval, 3);
  await page.locator('.deck-menu summary').click(); await click(page, 'remove-deck');
  await confirm(page);
  await expect(page.locator('.empty-state')).toBeVisible();
  await page.locator('#deck-file').setInputFiles(payload(content)); await confirm(page);
  await expect(page.locator('.deck-card h3')).toHaveText('Biology');
  assert.equal((await saved(page)).decks[0].cards[0].interval, 3);
  await page.locator('.deck-menu summary').click(); await click(page, 'reset-deck');
  await click(page, 'close-dialog');
  assert.equal((await saved(page)).decks[0].cards[0].interval, 3);
  await page.locator('.deck-menu summary').click(); await click(page, 'reset-deck');
  await confirm(page);
  assert.ok((await saved(page)).decks[0].cards.every(c => c.repetitions === 0));
  assert.equal((await saved(page)).stats.total_cards_reviewed, 4);
  await page.locator('#backup-file').setInputFiles(backupPath); await confirm(page);
  assert.equal((await saved(page)).decks[0].cards[0].interval, 3);

  // Invalid files cannot replace a valid workspace.
  const beforeInvalid = await page.evaluate(k => localStorage.getItem(k), key);
  await page.locator('#deck-file').setInputFiles({name: 'empty.md', mimeType: 'text/plain', buffer: Buffer.from('No cards here')});
  await expect(page.locator('#notice')).toContainText('No flashcards');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), beforeInvalid);
  await page.locator('#backup-file').setInputFiles({name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":99}')});
  await expect(page.locator('#notice')).toContainText('not a valid Revolv');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), beforeInvalid);

  // Statistics/mobile screens and safe stale-tab behavior.
  await page.keyboard.press('Control+s');
  await expect(page.locator('h1')).toHaveText('See your progress.');
  for (const width of [320, 390, 768, 1440]) { await page.setViewportSize({width, height: 900}); await noOverflow(page); }
  await page.screenshot({path: join(tmpdir(), 'revolv-statistics-desktop.png'), fullPage: true});
  await click(page, 'library');
  const other = await context.newPage(); await other.goto(origin);
  await click(other, 'shuffle');
  await expect(page.locator('#notice')).toContainText('another tab');
  const newer = await saved(other);
  await click(page, 'shuffle');
  await expect(page.locator('#notice')).toContainText('has not been applied');
  assert.deepEqual(await saved(page), newer);
  await click(page, 'reload');
  await expect(page.locator('[data-action="shuffle"]')).toHaveAttribute('aria-pressed', 'true');
  await other.close();

  // A failed atomic write must leave both persistent state and the UI unchanged.
  await page.evaluate(() => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException('Simulated full storage', 'QuotaExceededError'); };
  });
  const beforeFailure = await saved(page);
  await click(page, 'study');
  await expect(page.locator('#notice')).toContainText('could not save');
  assert.deepEqual(await saved(page), beforeFailure);
  await expect(page.locator('h1')).toHaveText('Make room for recall.');
  await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; delete window.originalSetItem; });

  // Corrupt saved JSON is retained and can still be exported.
  await page.evaluate(k => localStorage.setItem(k, '{broken'), key);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Your workspace is protected.');
  assert.equal(await page.evaluate(k => localStorage.getItem(k), key), '{broken');
  await page.locator('#backup-file').setInputFiles({name: 'recovery.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(beforeFailure))});
  await confirm(page);
  await expect(page.locator('h1')).toHaveText('Make room for recall.');
  assert.deepEqual(await saved(page), beforeFailure);
  // Numbered quiz imports use single-choice radios and visible A–D labels on mobile.
  await page.locator('#deck-file').setInputFiles({name: 'numbered-quiz.md', mimeType: 'text/markdown', buffer: Buffer.from('## Module 1: Ethics\n1. Which discipline studies morality?\nA. Physics\nB. Ethics\nC. Chemistry\nD. Astronomy\n\n## Answer Key\n1. B — Ethics studies moral principles.')});
  await expect.poll(async () => (await saved(page)).decks.length).toBe(2);
  const quizCard = page.locator('.deck-card').filter({has: page.getByRole('heading', {name: 'Numbered Quiz', exact: true})});
  await quizCard.locator('[data-action="study"]').click();
  await expect(page.locator('#question')).toHaveText('Which discipline studies morality?');
  assert.equal(await page.locator('input[type="radio"]').count(), 4);
  await page.setViewportSize({width: 320, height: 900});
  await noOverflow(page);
  for (const letter of ['A', 'B', 'C', 'D']) {
    await expect(page.locator('.choice-letter').filter({hasText: letter})).toBeVisible();
  }
  await page.locator('input[value="1"]').check();
  await click(page, 'reveal');
  await expect(page.locator('.choice-feedback')).toContainText('That’s correct.');
  await expect(page.locator('.answer-text')).toHaveText('Ethics studies moral principles.');
  assert.deepEqual(externalRequests, [], 'Imported content must not make network requests');
  assert.deepEqual(errors, [], 'Browser errors');
  console.log('PASS: desktop/mobile layouts, imports, ratings, both choice types, browser restart, backups, reset/removal, malformed data, stale tabs, storage failure, and imported-content safety.');
} finally {
  if (context) await context.close();
  await rm(profile, {recursive: true, force: true});
}
