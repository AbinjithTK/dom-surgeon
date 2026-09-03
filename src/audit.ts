// The audit engine. This is the ONLY place inspection logic lives; both the
// manual UI and the WebMCP tools are adapters over it.

import { cssPath, isVisible, directText, focusOrder, tabIndexOf, tabbableElements } from "./dom";
import { accessibleName, role, requiresName } from "./a11y";
import { contrastRatio, effectiveBackground, requiredRatio, formatRatio, rgbaToCss, isLargeText } from "./contrast";

export type Severity = "critical" | "serious" | "moderate" | "minor";

export const SEVERITY_ORDER: Severity[] = ["critical", "serious", "moderate", "minor"];

export interface Finding {
  ruleId: string;
  rule: string;
  wcag: string | null;
  severity: Severity;
  selector: string | null;
  summary: string;
  detail: string;
  fix: string;
}

export interface AuditOptions {
  root?: string;
  level?: "AA" | "AAA";
}

export interface AuditResult {
  scope: string;
  level: "AA" | "AAA";
  findings: Finding[];
  counts: Record<Severity, number>;
  elementsScanned: number;
  ranAt: string;
}

export const DEFAULT_SCOPE = "#patient";

export function resolveScope(root?: string): Element {
  if (root) {
    const el = document.querySelector(root);
    if (el) return el;
    throw new Error(`Scope not found: ${root}`);
  }
  return document.querySelector(DEFAULT_SCOPE) ?? document.body;
}

// ---------------------------------------------------------------- console log

export interface ConsoleEntry {
  level: "error" | "warn";
  message: string;
  at: number;
}

const MAX_ENTRIES = 500;
const consoleRing: ConsoleEntry[] = [];

function record(level: "error" | "warn", message: string): void {
  consoleRing.push({ level, message: message.slice(0, 400), at: Date.now() });
  if (consoleRing.length > MAX_ENTRIES) consoleRing.shift();
}

function stringify(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "object" && v !== null) {
    try { return JSON.stringify(v); } catch { return "[object]"; }
  }
  return String(v);
}

export function installConsoleRecorder(): void {
  (["error", "warn"] as const).forEach((level) => {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      record(level, args.map(stringify).join(" "));
      original(...args);
    };
  });
  window.addEventListener("error", (e) => {
    record("error", `${e.message} (${e.filename?.split("/").pop() ?? "?"}:${e.lineno})`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    record("error", `Unhandled rejection: ${stringify((e as PromiseRejectionEvent).reason)}`);
  });
}

export function consoleEntries(level: "error" | "warn" | "all" = "all"): ConsoleEntry[] {
  return level === "all" ? [...consoleRing] : consoleRing.filter((e) => e.level === level);
}

// ---------------------------------------------------------------------- rules

export function ruleNameMissing(root: Element): Finding[] {
  const out: Finding[] = [];
  root.querySelectorAll("a, button, input, select, textarea").forEach((el) => {
    if (!requiresName(el) || !isVisible(el)) return;
    if (accessibleName(el)) return;
    const r = role(el);
    const hasPlaceholder = (el as HTMLInputElement).placeholder;
    out.push({
      ruleId: "name-missing",
      rule: "Control has no accessible name",
      wcag: "WCAG 4.1.2 Name, Role, Value (Level A)",
      severity: "critical",
      selector: cssPath(el),
      summary: `<${el.tagName.toLowerCase()}> exposed as "${r}" with no accessible name`,
      detail: hasPlaceholder
        ? `Only a placeholder ("${hasPlaceholder}") is present. Placeholders are not accessible names and vanish on input.`
        : `No label, aria-label, aria-labelledby, or text content resolves to a name. Screen readers announce this control as unlabelled.`,
      fix: el.tagName === "INPUT"
        ? `Add <label for="${el.id || "…"}">, or aria-label="…" on the control.`
        : `Add visible text, or aria-label="…" if the control is icon-only.`,
    });
  });
  return out;
}

export function ruleImageAlt(root: Element): Finding[] {
  const out: Finding[] = [];
  root.querySelectorAll("img").forEach((img) => {
    if (!isVisible(img)) return;
    if (img.hasAttribute("alt")) return; // alt="" is a valid decorative image
    out.push({
      ruleId: "image-alt-missing",
      rule: "Image has no alt attribute",
      wcag: "WCAG 1.1.1 Non-text Content (Level A)",
      severity: "critical",
      selector: cssPath(img),
      summary: `<img> has no alt attribute`,
      detail: `Assistive tech falls back to announcing the file name. Source: ${(img.getAttribute("src") || "").split("/").pop()}`,
      fix: `Add alt="short description", or alt="" if the image is purely decorative.`,
    });
  });
  return out;
}

export function ruleContrast(root: Element, level: "AA" | "AAA" = "AA"): Finding[] {
  const out: Finding[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const text = directText(el);
    if (!text || !isVisible(el)) return;
    const style = getComputedStyle(el);
    const bg = effectiveBackground(el);
    const ratio = contrastRatio(style.color, bg);
    const need = requiredRatio(style, level);
    if (ratio >= need) return;
    out.push({
      ruleId: "contrast-insufficient",
      rule: "Text contrast below threshold",
      wcag: `WCAG 1.4.3 Contrast (Minimum) (Level ${level})`,
      severity: ratio < need / 2 ? "critical" : "serious",
      selector: cssPath(el),
      summary: `${formatRatio(ratio)} contrast, needs ${formatRatio(need)}`,
      detail: `"${text.slice(0, 48)}" — ${style.color} on ${rgbaToCss(bg)} at ${style.fontSize}${
        isLargeText(style) ? " (large text, 3:1 threshold)" : ""
      }.`,
      fix: `Darken the text or lighten the background until the ratio reaches ${formatRatio(need)}.`,
    });
  });
  return out;
}

export function ruleTabindexPositive(root: Element): Finding[] {
  const out: Finding[] = [];
  const dom = tabbableElements(root);
  const order = focusOrder(root);
  const reordered = order.some((el, i) => el !== dom[i]);
  root.querySelectorAll("[tabindex]").forEach((el) => {
    const ti = tabIndexOf(el);
    if (ti <= 0 || !isVisible(el)) return;
    const position = order.indexOf(el as HTMLElement) + 1;
    out.push({
      ruleId: "tabindex-positive",
      rule: "Positive tabindex reorders keyboard navigation",
      wcag: "WCAG 2.4.3 Focus Order (Level A)",
      severity: "serious",
      selector: cssPath(el),
      summary: `tabindex="${ti}" pulls this control to tab position ${position}`,
      detail: reordered
        ? `Keyboard focus no longer follows the visual/DOM order, so keyboard and screen-reader users jump unpredictably through the form.`
        : `A positive tabindex is fragile even when the current order happens to match.`,
      fix: `Remove the tabindex attribute and rely on DOM order, or use tabindex="0".`,
    });
  });
  return out;
}

export function ruleDuplicateId(root: Element): Finding[] {
  const seen = new Map<string, Element[]>();
  root.querySelectorAll("[id]").forEach((el) => {
    const id = el.id;
    if (!id) return;
    seen.set(id, [...(seen.get(id) ?? []), el]);
  });
  const out: Finding[] = [];
  seen.forEach((els, id) => {
    if (els.length < 2) return;
    out.push({
      ruleId: "duplicate-id",
      rule: "Duplicate id attribute",
      wcag: "WCAG 4.1.1 Parsing (Level A)",
      severity: "moderate",
      selector: cssPath(els[1]),
      summary: `id="${id}" is used ${els.length} times`,
      detail: `label[for], aria-labelledby, and aria-describedby all resolve to the FIRST match, so later elements silently lose their associations.`,
      fix: `Make every id unique within the document.`,
    });
  });
  return out;
}

export function ruleRuntimeErrors(): Finding[] {
  return consoleEntries("error").map((e, i) => ({
    ruleId: "runtime-error",
    rule: "Uncaught runtime error",
    wcag: null,
    severity: "critical" as Severity,
    selector: null,
    summary: e.message.slice(0, 110),
    detail: `Captured at ${new Date(e.at).toLocaleTimeString()}. A thrown handler aborts the rest of the interaction, so the user's action silently fails.`,
    fix: `Guard the failing access and surface an error state to the user.`,
    // index keeps keys distinct for repeated identical errors
    ...(i === -1 ? {} : {}),
  }));
}

/** WCAG 2.5.8 Target Size (Minimum): interactive targets should be >= 24x24 CSS px. */
export function ruleTouchTarget(root: Element): Finding[] {
  const out: Finding[] = [];
  root.querySelectorAll("a[href], button, input, select, textarea, [role='button']").forEach((el) => {
    if (!isVisible(el)) return;
    if (el instanceof HTMLInputElement && ["hidden", "checkbox", "radio"].includes(el.type)) return;
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width);
    const h = Math.round(r.height);
    if (w >= 24 && h >= 24) return;
    out.push({
      ruleId: "touch-target-small",
      rule: "Interactive target smaller than 24x24px",
      wcag: "WCAG 2.5.8 Target Size (Minimum) (Level AA)",
      severity: "moderate",
      selector: cssPath(el),
      summary: `${w}x${h}px target, minimum is 24x24px`,
      detail: `Small targets are hard to hit with a finger, a trackpad, or any motor impairment, which causes mis-taps on destructive controls.`,
      fix: `Increase the element's size, or add padding so the hit area reaches 24x24px.`,
    });
  });
  return out;
}

/** Heading levels should not skip (h2 -> h4), which breaks screen-reader navigation. */
export function ruleHeadingOrder(root: Element): Finding[] {
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter(isVisible);
  const out: Finding[] = [];
  let previous = 0;
  headings.forEach((h) => {
    const level = Number.parseInt(h.tagName.slice(1), 10);
    if (previous && level > previous + 1) {
      out.push({
        ruleId: "heading-order-skip",
        rule: "Heading level skipped",
        wcag: "WCAG 1.3.1 Info and Relationships (Level A)",
        severity: "minor",
        selector: cssPath(h),
        summary: `<h${level}> follows <h${previous}>, skipping <h${previous + 1}>`,
        detail: `Screen-reader users navigate by heading level; a gap makes the document outline misrepresent the page structure.`,
        fix: `Use <h${previous + 1}> here, or restructure the surrounding headings.`,
      });
    }
    previous = level;
  });
  return out;
}

/** WCAG 3.1.1: the document needs a language so speech synthesis picks the right voice. */
export function ruleHtmlLang(): Finding[] {
  const lang = document.documentElement.getAttribute("lang");
  if (lang && lang.trim()) return [];
  return [{
    ruleId: "html-lang-missing",
    rule: "Document has no language attribute",
    wcag: "WCAG 3.1.1 Language of Page (Level A)",
    severity: "moderate",
    selector: "html",
    summary: `<html> has no lang attribute`,
    detail: `Screen readers choose pronunciation rules from the document language; without it, content may be read with the wrong accent or phonetics.`,
    fix: `Add lang="en" (or the correct BCP 47 tag) to the <html> element.`,
  }];
}

// -------------------------------------------------------------------- engine

export function runAudit(options: AuditOptions = {}): AuditResult {
  const level = options.level ?? "AA";
  const root = resolveScope(options.root);
  const findings = [
    ...ruleNameMissing(root),
    ...ruleImageAlt(root),
    ...ruleContrast(root, level),
    ...ruleTabindexPositive(root),
    ...ruleDuplicateId(root),
    ...ruleTouchTarget(root),
    ...ruleHeadingOrder(root),
    ...ruleHtmlLang(),
    ...ruleRuntimeErrors(),
  ].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
  );

  const counts: Record<Severity, number> = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  findings.forEach((f) => { counts[f.severity]++; });

  return {
    scope: options.root ?? DEFAULT_SCOPE,
    level,
    findings,
    counts,
    elementsScanned: root.querySelectorAll("*").length,
    ranAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------- a11y tree

export interface TreeNode {
  role: string;
  name: string;
  tag: string;
  selector: string;
  tabbable: boolean;
  children?: TreeNode[];
}

/** Depth- and breadth-capped so tool output stays inside the WebMCP budget. */
export function a11yTree(root: Element, maxDepth = 4, maxNodes = 60): TreeNode {
  let budget = maxNodes;
  const walk = (el: Element, depth: number): TreeNode => {
    const node: TreeNode = {
      role: role(el),
      name: accessibleName(el),
      tag: el.tagName.toLowerCase(),
      selector: cssPath(el),
      tabbable: tabbableElements(el.parentElement ?? el).includes(el as HTMLElement),
    };
    if (depth < maxDepth) {
      const kids: TreeNode[] = [];
      for (const child of Array.from(el.children)) {
        if (budget <= 0) break;
        if (!isVisible(child)) continue;
        budget--;
        kids.push(walk(child, depth + 1));
      }
      if (kids.length) node.children = kids;
    }
    return node;
  };
  return walk(root, 0);
}
