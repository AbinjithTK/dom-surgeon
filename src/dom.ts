// DOM primitives. Everything here reads the LIVE rendered document.

/** Build a CSS selector and verify it resolves back to this exact element. */
export function cssPath(el: Element): string {
  if (el.id && isUnique(`#${CSS.escape(el.id)}`, el)) {
    return `#${CSS.escape(el.id)}`;
  }
  const segments: string[] = [];
  let node: Element | null = el;

  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    let seg = node.tagName.toLowerCase();

    const marker = node.getAttribute("data-testid") ?? node.getAttribute("data-remove");
    if (marker) {
      const attr = node.hasAttribute("data-testid") ? "data-testid" : "data-remove";
      seg += `[${attr}="${CSS.escape(marker)}"]`;
    } else if (node.id && isUnique(`#${CSS.escape(node.id)}`, node)) {
      // Only shortcut to an id when that id actually identifies ONE element.
      // Without this check a duplicated id produces a selector that resolves to
      // the wrong element — and the duplicate-id rule is precisely the case that
      // hits it, so a repair would be applied to the first twin instead of the
      // reported one, and revert could never find it again.
      seg = `#${CSS.escape(node.id)}`;
    } else {
      const parent: Element | null = node.parentElement;
      if (parent) {
        const twins = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
        if (twins.length > 1) seg += `:nth-of-type(${twins.indexOf(node) + 1})`;
      }
    }

    segments.unshift(seg);
    const candidate = segments.join(" > ");
    if (isUnique(candidate, el)) return candidate;
    if (seg.startsWith("#")) break;
    node = node.parentElement;
  }
  return segments.join(" > ") || el.tagName.toLowerCase();
}

function isUnique(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

/** querySelector that never throws. Returns null for invalid selectors. */
export function safeQuery(selector: string): { el: Element | null; error: string | null } {
  try {
    return { el: document.querySelector(selector), error: null };
  } catch {
    return { el: null, error: `Invalid CSS selector: ${selector}` };
  }
}

export function isVisible(el: Element): boolean {
  const s = getComputedStyle(el);
  if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

const FOCUSABLE =
  'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable="true"]';

/**
 * Correct tabbability: visible, enabled, not hidden, and tabindex !== -1.
 * (v1 wrongly counted tabindex="-1" and disabled controls as tabbable.)
 */
export function isTabbable(el: Element): boolean {
  if (!isVisible(el)) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  const ti = el.getAttribute("tabindex");
  if (ti !== null && Number.parseInt(ti, 10) < 0) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  return true;
}

export function tabbableElements(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isTabbable);
}

export function tabIndexOf(el: Element): number {
  return Number.parseInt(el.getAttribute("tabindex") || "0", 10) || 0;
}

/** Focus order: positive tabindex ascending (stable), then DOM order. */
export function focusOrder(root: Element): HTMLElement[] {
  const all = tabbableElements(root);
  const positive = all
    .filter((e) => tabIndexOf(e) > 0)
    .map((e, i) => ({ e, i }))
    .sort((a, b) => tabIndexOf(a.e) - tabIndexOf(b.e) || a.i - b.i)
    .map((x) => x.e);
  const natural = all.filter((e) => tabIndexOf(e) <= 0);
  return [...positive, ...natural];
}

export function directText(el: Element): string {
  return Array.from(el.childNodes)
    .filter((n) => n.nodeType === Node.TEXT_NODE)
    .map((n) => n.textContent || "")
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
