# Data Toolbox

A 100% offline web application with three developer tools:

1. **Compare texts** — detailed character-level diff, with side-by-side and inline modes.
2. **JSON** — strict validation, formatting and minification.
3. **JSON ⇄ YAML** — safe bidirectional conversion.

## How to open

Just open `index.html` directly in your browser (double-click it, or `Ctrl+O`
in the browser). No local server, `npm install` or build step is needed — and
the application works with the network disabled.

To run the test suite, open `tests.html` the same way.

## Privacy and security

- All processing happens in the browser. There is no `fetch`,
  `XMLHttpRequest`, WebSocket, WebRTC, analytics, cookies or telemetry.
- A Content Security Policy restricts scripts, styles and connections to the
  page's own origin (`connect-src 'none'` blocks any network call).
- User content is never inserted with `innerHTML`: all rendering uses text
  nodes (`textContent` / `createTextNode`), which prevents XSS.
- `localStorage` stores preferences only (theme and last tab). Editor
  contents are never stored.

## Project structure

```text
tanure.net/
├── index.html                 # the application
├── tests.html                 # in-browser test suite
├── css/
│   └── styles.css             # styles (light/dark themes, responsive)
├── js/
│   ├── core.js                # pure logic (diff, JSON, YAML) — no DOM
│   ├── app.js                 # UI and event wiring
│   └── tests.js               # automated tests
├── vendor/
│   ├── diff.min.js            # jsdiff 5.2.0 (BSD-3-Clause)
│   └── js-yaml.min.js         # js-yaml 4.1.0 (MIT)
├── README.md
└── THIRD_PARTY_NOTICES.txt
```

## Features

### Text comparator

- Two-stage diff: line alignment (jsdiff `diffLines`) and, inside changed
  lines, a character-level diff tokenized by grapheme cluster
  (`Intl.Segmenter`, with a code-point fallback) — accents and emoji are
  treated as whole characters.
- Options: ignore case, ignore whitespace, wrap long lines and synchronized
  scrolling.
- Side-by-side mode (with alignment placeholders) and inline mode
  (removed content struck through, added content underlined).
- Summary: characters added/removed, changed blocks and changed lines.
- Windows (`\r\n`) and Unix (`\n`) line endings are treated as equivalent.

### JSON

- Strict validation via `JSON.parse` (no comments, single quotes, unquoted
  keys or trailing commas), reporting line, column and a preview of the
  offending line.
- Formatting with 2 spaces, 4 spaces or tabs; minification; line, character
  and byte counters; open file (`FileReader`) and download
  (`Blob` + `URL.createObjectURL`, with `revokeObjectURL`).
- Invalid content is never modified.

### JSON ⇄ YAML

- Conversion uses the js-yaml library with the **CORE_SCHEMA** (YAML 1.2):
  only null, booleans, numbers and strings are resolved; custom or dangerous
  tags are rejected and nothing is ever executed.
- YAML values with no JSON equivalent (`.inf`, `.nan`, etc.) are adapted with
  a clear warning to the user.
- The YAML output preserves key order, uses no anchors/aliases (`noRefs`) and
  includes no unnecessary document markers.
- A failed conversion never erases the other panel's content.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `Ctrl+Enter` / `Cmd+Enter` | Main action of the active tab (Compare / Validate / Convert) |
| `Ctrl+Shift+F` / `Cmd+Shift+F` | Format JSON (on the JSON tab) |
| `←` `→` `Home` `End` | Navigate between tabs (with focus on the tab bar) |

## Accessibility

- Full keyboard navigation, visible focus and the WAI-ARIA tabs pattern.
- Success/error messages announced through an `aria-live` region.
- Diff indicators do not rely on color alone: additions are underlined and
  removals struck through/dotted, plus a permanent legend with + and −
  symbols.
- Light and dark themes with good contrast; preference saved locally.

## Third-party libraries

| Library | Version | License | Purpose |
| --- | --- | --- | --- |
| [jsdiff](https://github.com/kpdecker/jsdiff) | 5.2.0 | BSD-3-Clause | line alignment and base of the character diff |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.1.0 | MIT | YAML parsing and serialization |

Full details in `THIRD_PARTY_NOTICES.txt`.
