// Röktest mot riktiga YouTube: laddar tillägget i en headless Chromium och
// kontrollerar att kärnan (video, titel, kanal) finns kvar och att skräpet
// är borta, både vid direktladdning och vid navigering inom sidan.
// YouTube ändrar sig ofta; kör det här först när något verkar trasigt.
//
//   npm test
//   CHROME_PATH=/sökväg/till/chromium SHOTS=/tmp/shots npm test
//
// Kräver Chromium (inte Google Chrome, som ignorerar --load-extension).

import { chromium } from 'playwright-core';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const EXTENSION = resolve(import.meta.dirname, '..');
const SHOTS = process.env.SHOTS;
const VIDEO = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const SEARCH = 'https://www.youtube.com/results?search_query=';
const FILTER_LIVE = '&sp=EgJAAQ%253D%253D';
const FILTER_PLAYLIST = '&sp=EgIQAw%253D%253D';

const chromePath =
  process.env.CHROME_PATH ||
  ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'].find(existsSync);
if (!chromePath) {
  console.error('Hittar ingen Chromium. Ange sökvägen med CHROME_PATH.');
  process.exit(2);
}

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${ok ? '' : `  (${detail})`}`);
  if (!ok) failures++;
}

const profile = mkdtempSync(join(tmpdir(), 'yt-cleaner-test-'));
const context = await chromium.launchPersistentContext(profile, {
  executablePath: chromePath,
  headless: true,
  args: [
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `--disable-extensions-except=${EXTENSION}`,
    `--load-extension=${EXTENSION}`,
  ],
  viewport: { width: 1400, height: 900 },
});
// Hoppa över EU:s samtyckessida.
await context.addCookies([{ name: 'SOCS', value: 'CAI', domain: '.youtube.com', path: '/' }]);

const page = context.pages()[0] ?? (await context.newPage());
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

// Läser av watch-sidan. Väntar först tills titeln och spelaren är på plats.
async function inspectWatch() {
  await page.waitForSelector('ytd-watch-metadata h1', { timeout: 45_000 });
  // readyState 2 = spelaren har laddat videodata (autoplay är inte garanterat).
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2, null, {
    timeout: 45_000,
  });
  // Scrolla för att trigga lazy-laddning av kommentarer, om de nu finns kvar.
  await page.mouse.wheel(0, 2500);
  await page.waitForTimeout(3000);
  await page.mouse.wheel(0, -2500);

  return page.evaluate(() => {
    const visible = (sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0);
    const toggle = document.getElementById('yt-cleaner-toggle');
    return {
      title: document.querySelector('ytd-watch-metadata h1')?.innerText.trim(),
      channel: document.querySelector('ytd-watch-metadata ytd-channel-name a')?.innerText.trim(),
      related: document.querySelectorAll('#related yt-lockup-view-model, #related ytd-compact-video-renderer').length,
      commentSection: !!document.querySelector('ytd-comments ytd-item-section-renderer'),
      liveChat: !!document.querySelector('ytd-live-chat-frame iframe'),
      secondaryVisible: visible('ytd-watch-flexy #secondary'),
      playlistVisible: visible('ytd-playlist-panel-renderer#playlist'),
      toggle: toggle && {
        pressed: toggle.getAttribute('aria-pressed'),
        isLast: toggle === toggle.parentElement.lastElementChild,
        size: `${toggle.offsetWidth}x${toggle.offsetHeight}`,
      },
    };
  });
}

async function shot(name) {
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

function expectClean(s) {
  check('titel finns', !!s.title, s.title);
  check('kanal finns', !!s.channel, s.channel);
  check('inga relaterade videor', s.related === 0, `${s.related} st`);
  check('ingen kommentarssektion', !s.commentSection);
  check('ingen livechatt', !s.liveChat);
}

// Headless Chromium fastnar ibland i uppkopplingen mot YouTube, även utan
// tillägget. Ett nytt försök räcker nästan alltid.
async function open(url) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  } catch (e) {
    if (e.name !== 'TimeoutError') throw e;
    console.log('  … timeout, försöker igen');
    await page.goto(url, { waitUntil: 'domcontentloaded' });
  }
}

async function clickFirstResult(selector) {
  await page.waitForSelector(selector, { timeout: 45_000 });
  await page.click(selector);
  await page.waitForURL(/\/watch/);
}

try {
  console.log('Direktladdning av video');
  await open(VIDEO);
  let s = await inspectWatch();
  expectClean(s);
  check('högerkolumnen dold', !s.secondaryVisible);
  check('av/på-knappen finns och är på', s.toggle?.pressed === 'true', JSON.stringify(s.toggle));
  check('knappen sitter längst till höger', s.toggle?.isLast, JSON.stringify(s.toggle));
  check('knappen är 40x40', s.toggle?.size === '40x40', s.toggle?.size);
  await shot('1-direct');

  console.log('Navigering inom sidan (sök → video)');
  await open(SEARCH + 'never+gonna+give+you+up');
  await clickFirstResult('ytd-video-renderer a#thumbnail');
  s = await inspectWatch();
  expectClean(s);
  await shot('2-spa');

  console.log('Livesändning');
  await open(SEARCH + 'lofi+hip+hop+radio' + FILTER_LIVE);
  await clickFirstResult('ytd-video-renderer a#thumbnail');
  s = await inspectWatch();
  expectClean(s);
  await shot('3-live');

  console.log('Spellista (panelen ska vara kvar)');
  await open(SEARCH + '80s+hits' + FILTER_PLAYLIST);
  const playlistLink = 'a[href*="/watch"][href*="list="]';
  await page.waitForSelector(playlistLink, { state: 'attached', timeout: 45_000 });
  const playlistUrl = await page.$eval(playlistLink, (a) => a.href);
  await open(playlistUrl);
  s = await inspectWatch();
  expectClean(s);
  check('spellistan visas', s.playlistVisible);
  await shot('4-playlist');

  console.log('Stäng av med knappen');
  await open(VIDEO);
  await page.waitForSelector('#yt-cleaner-toggle');
  await Promise.all([page.waitForEvent('domcontentloaded'), page.click('#yt-cleaner-toggle')]);
  s = await inspectWatch();
  check('knappen visar av', s.toggle?.pressed === 'false', JSON.stringify(s.toggle));
  check('relaterade videor tillbaka', s.related > 0, `${s.related} st`);
  check('kommentarssektionen tillbaka', s.commentSection);
  await shot('5-off');

  console.log('Slå på igen');
  await Promise.all([page.waitForEvent('domcontentloaded'), page.click('#yt-cleaner-toggle')]);
  s = await inspectWatch();
  check('knappen visar på', s.toggle?.pressed === 'true', JSON.stringify(s.toggle));
  expectClean(s);

  console.log('Sidfel');
  check('inga JS-fel på sidan', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
} catch (e) {
  failures++;
  console.error('\nAvbröts:', e.message);
  await shot('error');
} finally {
  await context.close();
  rmSync(profile, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} fel` : '\nAllt OK');
process.exit(failures ? 1 : 0);
