# DOM-Surgeon — Engineering Spec

Status: v2 (production rebuild). Supersedes the v1 demo scaffold.

## 1. Product thesis

A **runtime accessibility & reliability auditor** that works two ways from the same engine:

1. **Standalone** — a human clicks *Run audit*; the page audits itself and reports WCAG findings with severity, rule IDs, and remediation. Valuable with no agent present.
2. **Agent-driven (WebMCP)** — an AI agent calls the same engine through 8 registered tools, in natural language, on the live page.

The audited data (computed styles after cascade, ARIA after hydration, real tab order, runtime console errors) exists **only in the live tab**, which is why WebMCP is the enabling technology rather than a decoration.

## 2. Verified WebMCP API (source: Chrome WebMCP docs, Imperative API, Aug 2026)

- Registration: `await document.modelContext.registerTool(tool, options)`
- `tool`: `{ name, description, inputSchema, annotations?, execute }`
- **`execute(input, { signal }) => string`** — returns a **plain string**, not an MCP content array.
- `options`: `{ signal?: AbortSignal, exposedTo?: string[] }`; `controller.abort()` unregisters.
- Discovery: `document.modelContext.getTools({ fromOrigins? })`; manual run: `executeTool(tool, jsonString, { signal })`.
- Events: `toolchange` on `document.modelContext`.
- Gating: requires an **origin-isolated** document; `tools` Permissions Policy defaults to `self`.
- Annotations: `readOnlyHint`, `untrustedContentHint`.
- **Budgets (hard design constraint):** ≤500 chars tool description, ≤150 chars parameter description, ≤30 chars names, **≤1.5K chars per tool output**.

Assumption: `navigator.modelContext` is not specified; retained only as a defensive fallback.

## 3. Architecture

```
src/
  dom.ts        selector paths, visibility, computed-style helpers
  a11y.ts       accessible-name + role resolution (ARIA algorithm subset)
  contrast.ts   WCAG relative luminance, ratio, large-text thresholds
  rules.ts      the audit rule set -> Finding[]
  audit.ts      audit engine + console recorder (single source of truth)
  render.ts     DOM-built findings list, overlays, summary, export
  tools.ts      8 WebMCP tools (thin adapters over audit.ts)
  webmcp.ts     capability detection, diagnostics, registration lifecycle
  patient.ts    demo fixture wiring
  main.ts       bootstrap
```

`audit.ts` is the **only** place inspection logic lives. Tools and the manual UI are both adapters over it — no duplicated logic, no demo-only paths.

## 4. Finding model

```ts
type Severity = "critical" | "serious" | "moderate" | "minor";
interface Finding {
  ruleId: string;      // "name-missing"
  rule: string;        // "Control has no accessible name"
  wcag: string | null; // "WCAG 4.1.2 Name, Role, Value (Level A)"
  severity: Severity;
  selector: string;    // verified-unique CSS path
  summary: string;     // one line, <=120 chars
  detail: string;      // measured evidence
  fix: string;         // remediation
}
```

## 5. Rule set (real logic, no placeholders)

| ruleId | Criterion | Severity | Logic |
|---|---|---|---|
| `name-missing` | WCAG 4.1.2 (A) | critical | Interactive element resolves to an empty accessible name via label/aria-label/aria-labelledby/title/text |
| `image-alt-missing` | WCAG 1.1.1 (A) | critical | `<img>` with no `alt` attribute (empty `alt=""` is valid, decorative) |
| `contrast-insufficient` | WCAG 1.4.3 (AA) | serious | Computed fg vs. composited bg ratio < 4.5 (or < 3.0 for large text: ≥24px, or ≥18.66px bold) |
| `tabindex-positive` | WCAG 2.4.3 (A) | serious | `tabindex > 0` reorders keyboard navigation away from DOM order |
| `duplicate-id` | WCAG 4.1.1 (A) | moderate | Same `id` used more than once (breaks label/aria references) |
| `runtime-error` | — (reliability) | critical | Uncaught exception / rejection / `console.error` captured this session |

Tabbability (correct definition): visible, not `disabled`, not `type="hidden"`, `tabindex !== "-1"`. Focus order = positive `tabindex` ascending, then DOM order.

## 6. The 8 tools

All return strings, all budget-capped at 1400 chars, all wrapped in a uniform error handler, all validate selector inputs, all honour `signal`.

| Tool | readOnly | Purpose |
|---|---|---|
| `audit_page` | yes | Run the full rule set; returns severity-ranked summary |
| `find_contrast_failures` | yes | Contrast rule only, with measured ratios |
| `find_missing_labels` | yes | Accessible-name + image-alt rules |
| `get_focus_order` | yes | Real tab sequence; flags positive-tabindex reordering |
| `get_a11y_tree` | yes | Depth- and size-capped accessibility tree |
| `describe_element` | yes | Deep inspect one selector + remediation |
| `get_console_log` | yes | Captured runtime errors/warnings |
| `reproduce_interaction` | no | Replay click/type/focus steps; report new errors |

`untrustedContentHint: true` on every tool that echoes page-derived text.

## 7. Error handling

- Each `execute` runs inside `runTool()`: catches, logs, returns `Error: <message>` as a string so the agent gets an actionable answer instead of a rejection.
- Selector inputs pass `safeQuery()` (try/catch around `querySelector`, explicit "no match" / "invalid selector" strings).
- `signal.aborted` checked between interaction steps; aborts return `Aborted after N steps`.
- Console buffer capped (500 entries, ring).

## 8. UI

- **Two-column app shell**: audit workspace (scope selector, Run audit, severity summary) + the page under test.
- Real type scale, system-UI stack with tabular numerals for ratios, monospace only for selectors/rule IDs. No emoji, no left-border card stack.
- Findings render as **focusable `<button>` rows** (keyboard operable, `aria-expanded`), grouped by severity with counts.
- Overlays: viewport-coordinate boxes in a fixed layer, **repositioned** on scroll/resize (not cleared).
- All DOM built via `document.createElement` + `textContent` — no `innerHTML` with page content.
- WebMCP status is a **diagnostic panel**, not a dead-end pill: states are Active / Unavailable (with the specific reason: no API, not origin-isolated, or policy-blocked) plus instructions. Manual audit works in every state.
- Export findings as JSON.

## 9. Acceptance

- `npm run build` passes `tsc` strict + Vite.
- With no WebMCP: Run audit produces ≥5 findings on the demo page with correct severities.
- With WebMCP: 8 tools register; every output ≤1.5K chars.
- Keyboard-only operation of DOM-Surgeon's own UI works end to end.
