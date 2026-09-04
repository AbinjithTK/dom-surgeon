// Presentation layer. All nodes are built with createElement/textContent —
// never innerHTML — because every string here may contain untrusted page text.

import { SEVERITY_ORDER, type Finding, type Severity } from "./audit";

type HighlightKind = "issue" | "contrast" | "focus";

interface Tracked { selector: string; kind: HighlightKind; label: string }

let tracked: Tracked[] = [];
let lastFindings: Finding[] = [];

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const byId = (id: string) => document.getElementById(id);

// ------------------------------------------------------------- overlays

export function highlight(selectors: string[], kind: HighlightKind = "issue"): number {
  tracked = selectors.map((selector, i) => ({
    selector,
    kind,
    label: kind === "focus" ? String(i + 1) : kind,
  }));
  return paintOverlays();
}

export function clearHighlights(): void {
  tracked = [];
  byId("overlay-layer")?.replaceChildren();
}

/**
 * Overlay boxes live in a position:fixed layer, so they are positioned with
 * VIEWPORT coordinates and repainted on scroll/resize. (v1 added scrollX/scrollY
 * into a fixed layer, which drifted as soon as the page scrolled.)
 */
export function paintOverlays(): number {
  const layer = byId("overlay-layer");
  if (!layer) return 0;
  layer.replaceChildren();
  let drawn = 0;

  for (const item of tracked) {
    let target: Element | null = null;
    try { target = document.querySelector(item.selector); } catch { continue; }
    if (!target) continue;
    const r = target.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;

    const box = el("div", "overlay-box");
    box.dataset.kind = item.kind;
    box.style.transform = `translate(${Math.round(r.left)}px, ${Math.round(r.top)}px)`;
    box.style.width = `${Math.round(r.width)}px`;
    box.style.height = `${Math.round(r.height)}px`;
    box.appendChild(el("span", "overlay-tag", item.label));
    layer.appendChild(box);
    drawn++;
  }
  return drawn;
}

export function installOverlayTracking(): void {
  let queued = false;
  const repaint = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (tracked.length) paintOverlays(); });
  };
  window.addEventListener("scroll", repaint, { passive: true });
  window.addEventListener("resize", repaint);
}

// ------------------------------------------------------------- findings

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: "Critical", serious: "Serious", moderate: "Moderate", minor: "Minor",
};

export interface PublishInput {
  findings: Finding[];
  scope: string;
  level: "AA" | "AAA";
  counts?: Record<Severity, number>;
  elementsScanned?: number;
}

export function publishFindings(result: PublishInput): void {
  lastFindings = result.findings;
  renderSummary(result);
  renderList(result.findings);
  const withSelectors = result.findings.map((f) => f.selector).filter((s): s is string => Boolean(s));
  if (withSelectors.length) highlight(withSelectors, "issue");
  const exportBtn = byId("export-report") as HTMLButtonElement | null;
  if (exportBtn) exportBtn.disabled = result.findings.length === 0;
}

function renderSummary(result: PublishInput): void {
  const host = byId("summary");
  if (!host) return;
  host.replaceChildren();

  const counts: Record<Severity, number> =
    result.counts ?? { critical: 0, serious: 0, moderate: 0, minor: 0 };
  if (!result.counts) result.findings.forEach((f) => { counts[f.severity]++; });

  const total = result.findings.length;
  const scoreWrap = el("div", "score");
  scoreWrap.appendChild(el("span", "score-value", String(total)));
  scoreWrap.appendChild(el("span", "score-label", total === 1 ? "issue found" : "issues found"));
  host.appendChild(scoreWrap);

  const chips = el("div", "chips");
  SEVERITY_ORDER.forEach((sev) => {
    const chip = el("span", `chip chip--${sev}`);
    chip.appendChild(el("span", "chip-count", String(counts[sev])));
    chip.appendChild(el("span", "chip-name", SEVERITY_LABEL[sev]));
    chips.appendChild(chip);
  });
  host.appendChild(chips);

  const meta = result.elementsScanned
    ? `${result.elementsScanned} elements · scope ${result.scope} · WCAG ${result.level}`
    : `scope ${result.scope} · WCAG ${result.level}`;
  host.appendChild(el("p", "summary-meta", meta));
}

function renderList(findings: Finding[]): void {
  const host = byId("findings");
  if (!host) return;
  host.replaceChildren();

  if (!findings.length) {
    const ok = el("div", "empty empty--pass");
    ok.appendChild(el("h2", undefined, "No barriers detected"));
    ok.appendChild(el("p", undefined, "Every check passed for the current region."));
    host.appendChild(ok);
    return;
  }

  const list = el("ul", "finding-list");
  findings.forEach((f, i) => {
    const item = el("li", "finding");
    const btn = el("button", "finding-head");
    btn.type = "button";
    btn.setAttribute("aria-expanded", "false");
    const bodyId = `finding-body-${i}`;
    btn.setAttribute("aria-controls", bodyId);

    btn.appendChild(el("span", `sev-dot sev-dot--${f.severity}`));
    const titles = el("span", "finding-titles");
    titles.appendChild(el("span", "finding-rule", f.rule));
    titles.appendChild(el("span", "finding-summary", f.summary));
    btn.appendChild(titles);
    btn.appendChild(el("span", "finding-sev", SEVERITY_LABEL[f.severity]));

    const body = el("div", "finding-body");
    body.id = bodyId;
    body.hidden = true;
    if (f.wcag) body.appendChild(el("p", "finding-wcag", f.wcag));
    body.appendChild(el("p", "finding-detail", f.detail));
    const fix = el("p", "finding-fix");
    fix.appendChild(el("strong", undefined, "Fix: "));
    fix.appendChild(document.createTextNode(f.fix));
    body.appendChild(fix);
    if (f.selector) {
      const sel = el("code", "finding-selector", f.selector);
      body.appendChild(sel);
      const locate = el("button", "link-btn");
      locate.type = "button";
      locate.textContent = "Highlight on page";
      locate.addEventListener("click", () => {
        highlight([f.selector!], "issue");
        document.querySelector(f.selector!)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
      body.appendChild(locate);
    }
    body.appendChild(el("p", "finding-rule-id", f.ruleId));

    btn.addEventListener("click", () => {
      const open = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!open));
      body.hidden = open;
    });

    item.appendChild(btn);
    item.appendChild(body);
    list.appendChild(item);
  });
  host.appendChild(list);
}

// ------------------------------------------------------------- activity

/**
 * Show a plain-language account of what was just repaired, at the top of the
 * findings panel. Call AFTER publishFindings, which replaces that panel's
 * children. Built with textContent — the narrative embeds page-derived strings.
 */
export function announce(message: string, tone: "repair" | "info" = "repair"): void {
  const host = byId("findings");
  if (!host) return;
  const note = el("div", `repair-note repair-note--${tone}`);
  note.setAttribute("role", "status");
  note.setAttribute("aria-live", "polite");
  note.appendChild(el("p", "repair-note-text", message));
  host.prepend(note);
}

export function logToolCall(name: string): void {
  const host = byId("activity");
  if (!host) return;
  const row = el("li", "activity-row");
  row.appendChild(el("code", undefined, name));
  row.appendChild(el("span", "activity-time", new Date().toLocaleTimeString()));
  host.prepend(row);
  while (host.children.length > 8) host.lastElementChild?.remove();
  byId("activity-wrap")?.removeAttribute("hidden");
}

// ------------------------------------------------------------- export
export function exportReport(): void {
  const blob = new Blob([JSON.stringify({ generatedAt: new Date().toISOString(), findings: lastFindings }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = el("a");
  a.href = url;
  a.download = `dom-surgeon-report-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
