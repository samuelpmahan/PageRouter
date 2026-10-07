import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE_URL = process.env.PXCUBE_CONNECT4_URL ?? 'http://127.0.0.1:4321/experiences/connect4/index.html';
const cartUrl = id => new URL(`../${id}/index.html`, BASE_URL).href;
const EVIDENCE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../evidence/connect4-gameboy');

async function captureEvidence(page, name) {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, name), fullPage: true });
}

async function chromiumFor(t) {
  try {
    const module = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
    const chromium = module.chromium ?? module.default?.chromium;
    if (chromium && typeof chromium.launch === 'function') return chromium;
  } catch { /* Report a skip below when this workspace lacks Playwright. */ }
  t.skip('Playwright with Chromium is not installed in this workspace');
  return null;
}

async function waitForState(page, { phase = 'playing', currentPlayer, cursorColumn, text } = {}) {
  await page.waitForFunction(({ phase, currentPlayer, cursorColumn, text }) => {
    const status = document.getElementById('game-status');
    if (!status || status.dataset.phase !== phase) return false;
    if (currentPlayer !== undefined && status.dataset.currentPlayer !== currentPlayer) return false;
    if (cursorColumn !== undefined && status.dataset.cursorColumn !== String(cursorColumn)) return false;
    if (text && !status.textContent.includes(text)) return false;
    return true;
  }, { phase, currentPlayer, cursorColumn, text });
}

async function openGame(page, id) {
  await page.goto(cartUrl(id));
  await waitForState(page, { currentPlayer: 'red' });
  await page.locator('#cartridge-select:enabled').waitFor();
}

async function resetGame(page) {
  await page.keyboard.press('Enter');
  await waitForState(page, { currentPlayer: 'red', cursorColumn: 3 });
}

async function moveToColumn(page, target) {
  const current = Number(await page.locator('#game-status').getAttribute('data-cursor-column'));
  const key = current > target ? 'ArrowLeft' : 'ArrowRight';
  for (let i = 0; i < Math.abs(current - target); i++) {
    await page.keyboard.press(key);
    await waitForState(page, { currentPlayer: 'red', cursorColumn: current + (key === 'ArrowLeft' ? -(i + 1) : i + 1) });
  }
}

async function dropAndWait(page, currentPlayerAfter) {
  await page.keyboard.press('x');
  await waitForState(page, { currentPlayer: currentPlayerAfter });
}

test('both Connect Four cartridges keep keyboard, held-button, full-column, win, reset, and save/reload flows', async t => {
  const chromium = await chromiumFor(t);
  if (!chromium) return;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  try {
    for (const id of ['connect4', 'connect4-pxc']) {
      await t.test(id, async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await openGame(page, id);
          await captureEvidence(page, `${id}-playable-board.png`);
          await page.keyboard.press('ArrowLeft');
          await waitForState(page, { currentPlayer: 'red', cursorColumn: 2 });
          await page.keyboard.down('ArrowLeft');
          await page.waitForTimeout(550);
          await page.keyboard.up('ArrowLeft');
          await waitForState(page, { currentPlayer: 'red', cursorColumn: 0 });

          await page.keyboard.press('x');
          await waitForState(page, { currentPlayer: 'yellow' });
          const saveKey = `pxcube:cartridge:${id}:connect4`;
          const firstSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
          assert.equal(firstSave.moveCount, 1);
          await page.reload();
          await waitForState(page, { currentPlayer: 'yellow', cursorColumn: 0 });

          // A long pointer hold is a single press, not a stream of drops.
          await resetGame(page);
          const aButton = page.locator('[data-btn="a"]');
          await aButton.scrollIntoViewIfNeeded();
          const box = await aButton.boundingBox();
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.mouse.down();
          await page.waitForTimeout(500);
          await page.mouse.up();
          await waitForState(page, { currentPlayer: 'yellow' });
          const heldSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
          assert.equal(heldSave.moveCount, 1, 'holding the touch-style A button drops exactly one piece');

          // Fill column zero, then verify an extra drop is rejected without switching players.
          await resetGame(page);
          await moveToColumn(page, 0);
          for (let move = 0; move < 6; move++) {
            await dropAndWait(page, move % 2 === 0 ? 'yellow' : 'red');
          }
          await page.keyboard.press('x');
          await waitForState(page, { currentPlayer: 'red', text: 'COLUMN FULL' });
          const fullSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
          assert.equal(fullSave.moveCount, 6);

          // Alternate into the adjacent column so Red wins vertically in column zero.
          await resetGame(page);
          await moveToColumn(page, 0);
          for (let pair = 0; pair < 3; pair++) {
            await dropAndWait(page, 'yellow');
            await page.keyboard.press('ArrowRight');
            await waitForState(page, { currentPlayer: 'yellow', cursorColumn: 1 });
            await dropAndWait(page, 'red');
            await page.keyboard.press('ArrowLeft');
            await waitForState(page, { currentPlayer: 'red', cursorColumn: 0 });
          }
          await page.keyboard.press('x');
          await waitForState(page, { phase: 'won', text: 'RED WINS' });
          await captureEvidence(page, `${id}-vertical-win.png`);
          await resetGame(page);
          const resetSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), saveKey);
          assert.equal(resetSave.moveCount, 0, 'Start resets and persists a fresh game');
          assert.deepEqual(errors, []);
        } finally {
          await context.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});

test('registered cartridge picker switches Snake, baseline Connect Four, and PxC Connect Four in place', async t => {
  const chromium = await chromiumFor(t);
  if (!chromium) return;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await openGame(page, 'connect4');
    const catalogOptions = await page.locator('#cartridge-select option').evaluateAll(options => options.map(option => option.value).filter(Boolean));
    assert.deepEqual(catalogOptions, ['connect4', 'connect4-pxc', 'snake']);
    await captureEvidence(page, 'registered-cartridge-picker.png');

    const cursorBeforePickerKeys = await page.locator('#game-status').getAttribute('data-cursor-column');
    await page.locator('#cartridge-select').focus();
    await page.keyboard.press('ArrowDown');
    await page.waitForFunction(() => document.getElementById('cartridge-select').value === 'connect4-pxc');
    assert.equal(await page.locator('#game-status').getAttribute('data-cursor-column'), cursorBeforePickerKeys,
      'keyboard use inside the picker does not also move the game cursor');
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(() => document.getElementById('cartridge-select').value === 'connect4');

    await page.locator('#cartridge-select').evaluate(select => {
      select.value = '../not-registered';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    assert.equal(await page.locator('#load-cartridge').isDisabled(), true, 'unregistered IDs cannot become navigable links');
    const baselineUrl = page.url();
    await page.evaluate(() => document.getElementById('load-cartridge').click());
    assert.equal(page.url(), baselineUrl);

    await page.locator('#cartridge-select').selectOption('connect4-pxc');
    await page.locator('#load-cartridge').focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(cartUrl('connect4-pxc'));
    await waitForState(page, { currentPlayer: 'red' });

    await page.evaluate(() => localStorage.setItem('pxcube:cartridge:snake:high', JSON.stringify(77)));
    await page.locator('#cartridge-select').selectOption('snake');
    await page.locator('#load-cartridge').click();
    await page.waitForURL(cartUrl('snake'));
    await page.waitForFunction(() => typeof window.ROM?.tick === 'function' && typeof window.ROM?.draw === 'function');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pxcube:cartridge:snake:high'))), 77);

    await page.locator('#cartridge-select').selectOption('connect4');
    await page.locator('#load-cartridge').click();
    await page.waitForURL(cartUrl('connect4'));
    await waitForState(page, { currentPlayer: 'red' });
    const keys = await page.evaluate(() => Object.keys(localStorage));
    assert.ok(keys.includes('pxcube:cartridge:connect4:connect4'));
    assert.ok(keys.includes('pxcube:cartridge:snake:high'), 'switching carts leaves Snake save namespace intact');
    assert.deepEqual(errors, []);
  } finally {
    await context.close();
    await browser.close();
  }
});

test('Game Boy cartridge picker and A control remain usable at a mobile viewport', async t => {
  const chromium = await chromiumFor(t);
  if (!chromium) return;
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    await openGame(page, 'connect4');
    await captureEvidence(page, 'mobile-gameboy-picker.png');
    await page.locator('#cartridge-select').selectOption('connect4-pxc');
    const loadBox = await page.locator('#load-cartridge').boundingBox();
    await page.touchscreen.tap(loadBox.x + loadBox.width / 2, loadBox.y + loadBox.height / 2);
    await page.waitForURL(cartUrl('connect4-pxc'));
    await waitForState(page, { currentPlayer: 'red' });
    const aButton = page.locator('[data-btn="a"]');
    await aButton.scrollIntoViewIfNeeded();
    const box = await aButton.boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    await waitForState(page, { currentPlayer: 'yellow' });
    await captureEvidence(page, 'mobile-connect4-touch-drop.png');
  } finally {
    await context.close();
    await browser.close();
  }
});
