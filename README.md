# DOM-Surgeon

**A runtime accessibility & reliability auditor that runs inside the live page — and
closes the feedback loop for AI coding agents.**

AI agents write UI they cannot see. It looks plausible and ships with unlabelled
inputs, unreadable buttons, and scrambled tab order. DOM-Surgeon measures the
*rendered* result and hands the findings back — to a human, to a browsing agent
via [WebMCP](https://github.com/webmachinelearning/webmcp), or to a coding agent
via a CLI that gates the dev loop.

## One engine, three surfaces

| Surface | Consumer | What it does |
|---|---|---|
| **WebMCP tools** (9, in-page) | Browsing agent + human | Ask in plain language; the agent audits the live DOM and highlights issues on screen |
| **CLI** | Coding agent, CI | `npx dom-surgeon audit <url> --json --fail-on critical` — structured findings, exit-code gate |
| **Bookmarklet / script tag** | Any page you own | Zero-install audit of your own app |

The engine (`src/audit.ts`) is UI-free and identical across all three. Verified:
the CLI and the in-page UI produce the same findings on the demo page.

→ **[AGENT_LOOP.md](./AGENT_LOOP.md)** documents the agent-in-the-loop workflow.

## Why WebMCP is the enabling technology

The audited data exists **only in the running tab**:

- computed styles after the full CSS cascade (real contrast ratios),
- ARIA state after JavaScript hydration (real accessible names),
- the real keyboard focus order, including positive-`tabindex` reordering,
- uncaught exceptions and console errors from *this* session.

No server-side MCP can see any of it. Static HTML analysis misses everything JS
produces. Scraping cannot read computed accessibility state. The agent has to
execute **inside the page** — which is exactly what WebMCP enables. DOM-Surgeon
inverts the usual framing: instead of "let an agent drive my app," it is "let an
agent *inspect the page it lives in*."

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # engine bundle + static site into dist/
```

Audit your own app:

```bash
npm i -D playwright && npx playwright install chromium
npx dom-surgeon audit http://localhost:5173 --json
```

## The 9 WebMCP tools

`audit_page` · `find_contrast_failures` · `find_missing_labels` ·
`get_focus_order` · `get_a11y_tree` · `describe_element` · `get_console_log` ·
`reproduce_interaction` · `highlight_elements`

All registered via `document.modelContext.registerTool`, all returning plain
strings within the documented 1.5K output budget, all annotated with
`readOnlyHint` / `untrustedContentHint`, all error-wrapped and `AbortSignal`-aware.

## Test with an agent

1. Open the deployed URL in **ChatGPT's in-app browser**, or **Chrome 149+** with
   `chrome://flags/#enable-webmcp-testing` enabled, then restart.
2. The header badge reads **WebMCP active · 9/9 tools**.
3. Ask: *"Audit this checkout page for accessibility problems."*

The manual **Run audit** button works in any browser, with or without WebMCP.

## Demo page

The right pane is a checkout with five **intentional** defects so every rule has
something real to find: an input with only a placeholder, a pay button at 2.38:1
contrast, `tabindex="5"` scrambling focus order, icon-only remove buttons with no
accessible name, a duplicate `id`, and a submit handler that throws.

## Deploy

Static Vite build, zero backend.

```bash
npx vercel     # framework auto-detects as Vite; vercel.json pins build + output
```

## Architecture

```
src/
  dom.ts            verified-unique selectors, tabbability, visibility
  a11y.ts           accessible-name + role resolution (ARIA subset)
  contrast.ts       WCAG luminance, alpha compositing, large-text thresholds
  audit.ts          rule set + console recorder  ← single source of truth
  engine-entry.ts   standalone injectable bundle (window.DOMSurgeon)
  tools.ts          9 WebMCP tools (thin adapters over audit.ts)
  webmcp.ts         capability detection + registration lifecycle
  render.ts         DOM-built findings UI, overlays, export
bin/dom-surgeon.mjs CLI (Playwright injects the engine into your page)
```

See [SPEC.md](./SPEC.md) for the full engineering spec.

## Limitations

- **Same-origin policy**: the engine must run inside the page being audited; you
  cannot audit an arbitrary third-party URL from a hosted page.
- **Automated rules catch a subset of accessibility.** This gates regressions; it
  does not certify conformance.
- **WebMCP is experimental**, behind a Chrome flag / origin trial. The CLI path has
  no such dependency.

## License

MIT — see [LICENSE](./LICENSE).
