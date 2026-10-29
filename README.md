# YT Cleaner

A Chrome extension that strips YouTube's watch page down to the video, title,
channel and description. Comments, related videos, live chat, end screens,
merch shelves and similar clutter are removed **before YouTube loads them**,
so they never cost memory, bandwidth or CPU. Made for machines with little RAM.

## What you get

On a watch page, only this is left:

- the player
- title, channel, subscribe button and like/dislike
- the description (with music, people, transcript and channel cards removed)
- the playlist panel, when you are watching a playlist

Everywhere on YouTube, Shorts shelves, in-feed ad slots, voice search, the
create button and the notification bell are hidden.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the repository folder.

Works in Chrome, Chromium, Brave, Edge and other Chromium-based browsers,
version 120 or later.

## On/off button

A green button sits at the far right of YouTube's top bar. Click it to turn the
cleaning off or on; the page reloads so the change takes effect immediately
(content that was never loaded cannot be brought back without a reload). The
setting is remembered.

## How it works

Hiding elements with CSS alone saves nothing: YouTube still downloads and
renders everything. Instead, `src/prune.js` runs in the page before YouTube
starts and removes the unwanted parts from YouTube's own data, both the data
embedded in the first page load and the data fetched when you navigate within
the site. YouTube then never builds those components.

`src/clean.css` is a fallback that hides anything that slips through, for
example if YouTube changes its data format.

Measured on the same video: about 33% fewer DOM nodes, about 20% less
JavaScript heap, and a third of the images, before comments would even have
started loading.

## Privacy

The extension requests no permissions, makes no network requests and collects
nothing. It only runs on `www.youtube.com`. The on/off setting is stored in
YouTube's own local storage under the key `yt-cleaner:disabled`.

## Limitations

- Ads inside the player are not blocked. Tampering with them tends to trigger
  YouTube's ad-blocker detection; use a dedicated ad blocker for that.
- The home page and subscriptions feed are left alone, apart from Shorts and
  ad slots.
- The mobile site (`m.youtube.com`) and embedded players are not supported.

## Development

YouTube changes its markup and data often. A smoke test runs the extension
against the live site in headless Chromium and checks direct loads, in-site
navigation, live streams, playlists and the on/off button:

```sh
npm install
npm test                          # needs Chromium; set CHROME_PATH if it isn't found
SHOTS=/tmp/shots npm test         # also saves screenshots
```

Google Chrome ignores `--load-extension`, so the test needs Chromium.

Other scripts:

```sh
npm run icons   # regenerate PNG icons from icons/icon.svg (needs rsvg-convert)
npm run pack    # build dist/yt-cleaner.zip for the Chrome Web Store
```
