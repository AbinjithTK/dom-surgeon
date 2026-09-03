# Agent-in-the-loop: closing the feedback loop on generated UI

AI coding agents write UI they cannot see. The result looks plausible and ships
with unlabelled inputs, unreadable buttons, and scrambled tab order — because
nothing measures the *rendered* result and reports back.

DOM-Surgeon closes that loop. The agent can't see the render, but it can read
**measurements of** the render.

## The loop

```
agent writes UI  →  dom-surgeon audit <dev-url> --json  →  structured findings
       ↑                                                          │
       └──────────────  agent edits source  ←─────────────────────┘
                        (repeat until exit 0)
```

## Give your agent this instruction

> After you change any UI, run:
> `npx dom-surgeon audit http://localhost:5173 --json --fail-on critical`
> Parse the `findings` array. Each entry has `selector`, `rule`, `wcag`, `severity`,
> and `fix`. Fix the source for every critical and serious finding, then re-run
> until the command exits 0. Do not claim the UI is done while it exits 1.

That works with any agent that can run a shell command — Claude Code, Cursor,
Codex CLI, Kiro, Aider — with no MCP configuration.

## Why not WebMCP for this?

WebMCP tools live on `document.modelContext`: they need a **browser page
context**. Terminal and IDE agents have a filesystem and a shell, not a
`document`, so they cannot consume WebMCP tools. Chrome's docs also list headless
use as a limitation and describe WebMCP as designed for "local browser workflows
with a human in the loop."

So there are two front-ends over one engine:

| Surface | Consumer | Use |
|---|---|---|
| **WebMCP tools** (9, in-page) | Browsing agent + human | Conversational audit, "why does this fail for keyboard users?", visual highlighting |
| **CLI** (Playwright injects the engine) | Coding agent, CI | Automated gate in the dev loop |

The engine (`src/audit.ts`) is UI-free and identical in both. Verified: the CLI and
the in-page UI return the same 6 findings on the demo page.

## Commands

```bash
# one page, human-readable
npx dom-surgeon audit http://localhost:5173

# agent-facing
npx dom-surgeon audit http://localhost:5173 --json

# several routes at once
npx dom-surgeon audit http://localhost:5173 / /checkout /settings

# CI gate — exits 1 if anything critical is present
npx dom-surgeon audit http://localhost:5173 --fail-on critical

# regression mode: only NEW findings fail the build
npx dom-surgeon audit http://localhost:5173 --save-baseline a11y.json
npx dom-surgeon audit http://localhost:5173 --baseline a11y.json --fail-on serious

# PR comment
npx dom-surgeon audit http://localhost:5173 --markdown
```

Exit codes: `0` clean / below threshold · `1` findings at or above `--fail-on` ·
`2` usage or runtime error.

Requires Playwright for the CLI only:
`npm i -D playwright && npx playwright install chromium`.

## Rules checked

| ruleId | Criterion | Severity |
|---|---|---|
| `name-missing` | WCAG 4.1.2 Name, Role, Value (A) | critical |
| `image-alt-missing` | WCAG 1.1.1 Non-text Content (A) | critical |
| `contrast-insufficient` | WCAG 1.4.3 Contrast Minimum (AA) | serious |
| `tabindex-positive` | WCAG 2.4.3 Focus Order (A) | serious |
| `duplicate-id` | WCAG 4.1.1 Parsing (A) | moderate |
| `runtime-error` | reliability (non-WCAG) | critical |

Contrast applies the large-text exemption (≥24px, or ≥18.66px bold → 3:1) and
composites translucent backgrounds. Focus order excludes `disabled`,
`aria-hidden`, `type="hidden"`, and `tabindex="-1"` — so the reported tab
sequence is the one a keyboard user actually gets.

## In-page programmatic API

Once `dom-surgeon-engine.js` is loaded on a page:

```js
DOMSurgeon.audit({ root: "body", level: "AA" });   // -> AuditResult
DOMSurgeon.diff(savedFindings);                     // -> { added, fixed, unchanged }
DOMSurgeon.toMarkdown(result);                      // -> PR-ready table
DOMSurgeon.report();                                // audit + console output
```

Useful inside Playwright/Cypress tests, or from a bookmarklet.

## Honest limitations

- **Same-origin policy**: the engine must run *inside* the page being audited.
  There is no way to audit `someone-elses-site.com` from a hosted page. Hence the
  CLI (Playwright loads your page) and the bookmarklet (you open your page).
- **Automated rules catch a subset of accessibility.** Reading order, meaningful
  alt text, and cognitive load need a human. This gates regressions; it does not
  certify conformance.
- **WebMCP is experimental** and behind a Chrome flag / origin trial. The CLI path
  has no such dependency.
