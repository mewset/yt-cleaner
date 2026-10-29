// Körs i sidans egen JS-kontext (world: MAIN) innan YouTube hinner starta.
// Rensar bort skräp ur YouTubes data innan appen ser den, så att
// kommentarer, relaterade videor, livechatt m.m. aldrig byggs upp i DOM:en
// och aldrig laddar thumbnails. Det är det som faktiskt sparar minne;
// CSS-döljning ensam gör det inte.
(() => {
  'use strict';

  // Samma nyckel som i toggle.js. localStorage för att den går att läsa
  // synkront här; chrome.storage finns inte i MAIN-världen.
  const STORAGE_KEY = 'yt-cleaner:disabled';
  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return;
  } catch {
    // Blockerad lagring: rensa som vanligt.
  }

  // Huvudkolumnen under videon: titel/visningar och kanal/beskrivning.
  const KEEP_PRIMARY = [
    'videoPrimaryInfoRenderer',
    'videoSecondaryInfoRenderer',
    'compositeVideoPrimaryInfoRenderer',
  ];
  const REQUIRED_PRIMARY = ['videoPrimaryInfoRenderer'];

  // Den utfällda beskrivningen: rubrik, visningar/datum och själva texten.
  // Bort med musikkort, personer, transkript-knapp, kanalkort m.m.
  const KEEP_DESCRIPTION = [
    'videoTitleHeaderViewModel',
    'videoDescriptionHeaderRenderer',
    'expandableVideoDescriptionBodyRenderer',
  ];
  const REQUIRED_DESCRIPTION = ['expandableVideoDescriptionBodyRenderer'];

  // Behåller bara poster vars nyckel finns i `keep`. Saknas alla `required`
  // har YouTube troligen bytt namn på något; då lämnas listan orörd och
  // CSS-reserven får göra jobbet. Hellre lite skräp än en sida utan titel.
  function keepOnly(list, keep, required) {
    if (!Array.isArray(list)) return list;
    if (!list.some((item) => required.some((key) => key in item))) return list;
    return list.filter((item) => keep.some((key) => key in item));
  }

  function pruneWatchNext(data) {
    if (!data || typeof data !== 'object') return data;

    const watch = data.contents?.twoColumnWatchNextResults;
    // I en spellista styr autoplay-datan vilken video som kommer härnäst,
    // och utan den visar YouTube inte ens spellistepanelen.
    const inPlaylist = !!watch?.playlist;
    if (watch) {
      delete watch.secondaryResults; // relaterade videor
      delete watch.conversationBar; // livechatt (tung iframe)
      if (!inPlaylist) delete watch.autoplay; // nästa video att autospela

      const results = watch.results?.results;
      if (results) {
        // Kommentarer, merch, biljetter, produkthyllor
        results.contents = keepOnly(results.contents, KEEP_PRIMARY, REQUIRED_PRIMARY);
      }
    }

    if (Array.isArray(data.engagementPanels)) {
      data.engagementPanels = data.engagementPanels.filter((panel) => {
        const id = panel.engagementPanelSectionListRenderer?.targetId || '';
        return !id.includes('comment');
      });

      for (const panel of data.engagementPanels) {
        const description =
          panel.engagementPanelSectionListRenderer?.content?.structuredDescriptionContentRenderer;
        if (description) {
          description.items = keepOnly(description.items, KEEP_DESCRIPTION, REQUIRED_DESCRIPTION);
        }
      }
    }

    const overlay = data.playerOverlays?.playerOverlayRenderer;
    if (overlay) {
      delete overlay.endScreen; // videovägg när videon tar slut
      if (!inPlaylist) delete overlay.autoplay; // autoplay-knappen och nedräkningen
    }

    return data;
  }

  function prunePlayer(data) {
    if (!data || typeof data !== 'object') return data;
    delete data.endscreen; // klickbara rutor de sista sekunderna
    delete data.cards; // "i"-kort uppe till höger
    delete data.annotations;
    return data;
  }

  // get_watch slår ihop player och next i ett anrop: en array där varje del
  // har antingen playerResponse eller watchNextResponse.
  function pruneGetWatch(data) {
    for (const part of Array.isArray(data) ? data : [data]) {
      if (part?.playerResponse) prunePlayer(part.playerResponse);
      if (part?.watchNextResponse) pruneWatchNext(part.watchNextResponse);
    }
    return data;
  }

  // Första sidladdningen: YouTube lägger datan i globala variabler via inline-script.
  // En setter fångar värdet innan appen läser det.
  function trapGlobal(name, prune) {
    let value;
    try {
      Object.defineProperty(window, name, {
        configurable: true,
        get: () => value,
        set: (v) => {
          value = prune(v);
        },
      });
    } catch (e) {
      console.warn('[yt-cleaner] kunde inte fånga', name, e);
    }
  }

  trapGlobal('ytInitialData', pruneWatchNext);
  trapGlobal('ytInitialPlayerResponse', prunePlayer);

  // Navigering inom sidan (SPA): datan kommer via fetch mot youtubei-API:t.
  const ENDPOINTS = [
    ['/youtubei/v1/get_watch', pruneGetWatch],
    ['/youtubei/v1/next', pruneWatchNext],
    ['/youtubei/v1/player', prunePlayer],
  ];

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const response = await origFetch.call(this, input, init);

    const url = typeof input === 'string' ? input : input?.url || String(input);
    const match = ENDPOINTS.find(([path]) => url.includes(path));
    if (!match || !response.ok) return response;

    try {
      const json = await response.clone().json();

      // Kroppen är redan avkodad och får ny längd, så de här stämmer inte längre.
      const headers = new Headers(response.headers);
      headers.delete('content-length');
      headers.delete('content-encoding');

      const pruned = new Response(JSON.stringify(match[1](json)), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
      Object.defineProperty(pruned, 'url', { value: response.url });
      return pruned;
    } catch {
      return response;
    }
  };
})();
