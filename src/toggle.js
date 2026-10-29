// Av/på-knapp längst till höger i YouTubes topprad.
// Läget sparas i youtube.com:s localStorage så att prune.js kan läsa det
// synkront innan YouTube startar. Ett byte laddar om sidan, eftersom data
// som redan rensats bort inte går att få tillbaka utan en ny laddning.
(() => {
  'use strict';

  const STORAGE_KEY = 'yt-cleaner:disabled'; // samma som i prune.js
  const OFF_ATTR = 'data-yt-cleaner-off'; // stänger av reglerna i clean.css
  const BUTTON_ID = 'yt-cleaner-toggle';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // Samma motiv som icons/icon.svg.
  const PATHS = {
    play: 'M9 7.6v8.8c0 .6.6.9 1.1.6l6.7-4.4c.4-.3.4-.9 0-1.2L10.1 7c-.5-.3-1.1 0-1.1.6Z',
    sparkle: 'M17.5 3.6l.6 1.8 1.8.6-1.8.6-.6 1.8-.6-1.8-1.8-.6 1.8-.6Z',
    slash: 'M4 20 20 4',
  };

  let disabled = false;
  try {
    disabled = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    // Utan lagring går läget inte att spara, så ingen knapp heller.
    return;
  }

  if (disabled) document.documentElement.setAttribute(OFF_ATTR, '');

  function toggle() {
    if (disabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, '1');
    location.reload();
  }

  function svg(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    return el;
  }

  // Byggs med createElementNS: YouTube kräver Trusted Types, så innerHTML är uteslutet.
  function createIcon() {
    const icon = svg('svg', { viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true' });
    icon.append(
      svg('rect', { class: 'ytc-tile', x: '2.75', y: '2.75', width: '18.5', height: '18.5', rx: '5.5' }),
      svg('path', { class: 'ytc-glyph', d: PATHS.play }),
      svg('path', { class: 'ytc-glyph', d: PATHS.sparkle }),
      svg('path', { class: 'ytc-slash-gap', d: PATHS.slash }),
      svg('path', { class: 'ytc-slash', d: PATHS.slash })
    );
    return icon;
  }

  function createButton() {
    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', 'YT Cleaner');
    button.setAttribute('aria-pressed', String(!disabled));
    button.dataset.tooltip = chrome.i18n.getMessage(disabled ? 'toggleTooltipOff' : 'toggleTooltipOn');
    button.append(createIcon());
    button.addEventListener('click', toggle);
    return button;
  }

  function mount() {
    if (document.getElementById(BUTTON_ID)) return true;
    const end = document.querySelector('ytd-masthead #end');
    if (!end) return false;
    end.append(createButton());
    return true;
  }

  // Toppraden byggs av YouTubes JS först efter att det här skriptet körts.
  const observer = new MutationObserver(() => {
    if (mount()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });

  // YouTube kan bygga om toppraden vid navigering inom sidan.
  document.addEventListener('yt-navigate-finish', mount);
})();
