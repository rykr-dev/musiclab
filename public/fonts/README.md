# Fonts

Both faces are self-hosted rather than linked from a CDN: MUSIC LAB is a
static-assets Worker with no backend, and it has to keep working on a school
network that may block third-party origins.

| File | Family | Axes | Used for |
|---|---|---|---|
| `archivo-latin.woff2`, `archivo-latin-ext.woff2` | Archivo | `wght` 400–800, `wdth` 62–125 | All chrome — the wordmark, panel labels, buttons, names |
| `chivomono-latin.woff2` | Chivo Mono | `wght` 400–800 | Every number — knob values, transport readout, mixer levels |

Subsets are the `latin` (and, for Archivo, `latin-ext`) slices Google Fonts
serves. `latin-ext` is declared with its own `unicode-range`, so it is only
fetched when a song title actually contains one of those characters.

## Licensing

Both are licensed under the SIL Open Font License 1.1 — see `Archivo-OFL.txt`
and `ChivoMono-OFL.txt`. The OFL permits bundling and serving the fonts,
including commercially, provided the license travels with the font files. Keep
these two .txt files next to the .woff2 files if you move them.

- Archivo — Copyright 2020 The Archivo Project Authors, https://github.com/Omnibus-Type/Archivo
- Chivo Mono — Copyright 2019 The Chivo Project Authors, https://github.com/Omnibus-Type/Chivo

## Replacing or updating them

`src/constants.js` declares the families in `FONT_UI` / `FONT_MONO` and the type
roles in `TYPE`; `src/index.css` holds the `@font-face` blocks and
`index.html` preloads the two latin files. A swapped face needs all three
touched, plus `useFontsReady()` in `PianoRoll.jsx` still forces the one canvas
repaint that keeps pitch names out of the fallback.
