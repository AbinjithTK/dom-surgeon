// Remediation: the agent does not just report a defect, it repairs the live DOM
// so the human watches the finding turn green — then re-audits to prove it.
//
// Every mutation is recorded so it can be reverted, and each fix also yields a
// source-level patch suggestion, because the DOM fix is a demonstration and the
// real fix belongs in the codebase.

import { safeQuery, cssPath } from "./dom";
import { accessibleName } from "./a11y";
import { contrastRatio, effectiveBackground, requiredRatio } from "./contrast";

export interface AppliedFix {
  selector: string;
  ruleId: string;
  attribute: string;
  previousValue: string | null;
  newValue: string;
  patch: string;
}

const applied: AppliedFix[] = [];

function record(el: Element, ruleId: string, attribute: string, newValue: string, patch: string): AppliedFix {
  const previousValue = el.getAttribute(attribute);
  const fix: AppliedFix = { selector: cssPath(el), ruleId, attribute, previousValue, newValue, patch };
  applied.push(fix);
  return fix;
}

/** Derive a sensible accessible name from nearby context. */
function inferName(el: Element): string {
  const placeholder = (el as HTMLInputElement).placeholder?.trim();
  if (placeholder) return placeholder;

  const aria = el.getAttribute("data-label")?.trim();
  if (aria) return aria;

  // Icon-only control: use the item text it sits beside.
  const row = el.closest("li, tr, .row");
  const rowText = row?.querySelector("span, td, label")?.textContent?.trim();
  if (rowText) {
    const action = el.tagName === "BUTTON" ? "Remove" : "";
    return action ? `${action} ${rowText}` : rowText;
  }

  const marker = el.getAttribute("data-remove");
  if (marker) return `Remove ${marker}`;

  const type = (el as HTMLInputElement).type;
  if (type && type !== "text") return type;
  return el.tagName.toLowerCase();
}

/** Darken a foreground colour until it meets the required ratio on its background. */
function accessibleForeground(el: Element): { color: string; ratio: number } | null {
  const style = getComputedStyle(el);
  const bg = effectiveBackground(el);
  const need = requiredRatio(style, "AA");
  const match = style.color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const [r, g, b] = match[1].split(",").map((v) => Number.parseFloat(v.trim()));

  // Walk the colour toward black (or white on a dark backdrop) in small steps.
  const towardWhite = effectiveBackground(el)[0] < 128;
  for (let step = 0; step <= 100; step++) {
    const t = step / 100;
    const nr = Math.round(towardWhite ? r + (255 - r) * t : r * (1 - t));
    const ng = Math.round(towardWhite ? g + (255 - g) * t : g * (1 - t));
    const nb = Math.round(towardWhite ? b + (255 - b) * t : b * (1 - t));
    const candidate = `rgb(${nr}, ${ng}, ${nb})`;
    const ratio = contrastRatio(candidate, bg);
    if (ratio >= need) return { color: candidate, ratio: Math.round(ratio * 100) / 100 };
  }
  return null;
}

export interface FixOutcome {
  ok: boolean;
  message: string;
  fix?: AppliedFix;
}

/**
 * Apply a real remediation for one finding on the live page.
 * Supported: name-missing, image-alt-missing, contrast-insufficient,
 * tabindex-positive, duplicate-id, html-lang-missing.
 */
export function applyFix(selector: string, ruleId: string): FixOutcome {
  const { el, error } = safeQuery(selector);
  if (error) return { ok: false, message: error };
  if (!el) return { ok: false, message: `No element matches ${selector}.` };

  switch (ruleId) {
    case "name-missing": {
      if (accessibleName(el)) return { ok: false, message: "This control already has an accessible name." };
      const name = inferName(el);
      const patch = `<${el.tagName.toLowerCase()} aria-label="${name}" …>`;
      const fix = record(el, ruleId, "aria-label", name, patch);
      el.setAttribute("aria-label", name);
      return { ok: true, message: `Set aria-label="${name}". Source fix: ${patch}`, fix };
    }

    case "image-alt-missing": {
      if (el.hasAttribute("alt")) return { ok: false, message: "This image already has an alt attribute." };
      const src = (el.getAttribute("src") || "").split("/").pop() || "image";
      const alt = src.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ");
      const patch = `<img alt="${alt}" …>  <!-- use alt="" if decorative -->`;
      const fix = record(el, ruleId, "alt", alt, patch);
      el.setAttribute("alt", alt);
      return { ok: true, message: `Set alt="${alt}" (review the wording). Source fix: ${patch}`, fix };
    }

    case "contrast-insufficient": {
      const better = accessibleForeground(el);
      if (!better) return { ok: false, message: "Could not find a compliant colour automatically; adjust the background instead." };
      const patch = `color: ${better.color};  /* was ${getComputedStyle(el).color} */`;
      const fix = record(el, ruleId, "style", better.color, patch);
      (el as HTMLElement).style.color = better.color;
      return { ok: true, message: `Raised contrast to ${better.ratio}:1. Source fix: ${patch}`, fix };
    }

    case "tabindex-positive": {
      const current = el.getAttribute("tabindex");
      if (!current || Number.parseInt(current, 10) <= 0) return { ok: false, message: "No positive tabindex on this element." };
      const patch = `remove tabindex="${current}" and rely on DOM order`;
      const fix = record(el, ruleId, "tabindex", "", patch);
      el.removeAttribute("tabindex");
      return { ok: true, message: `Removed tabindex="${current}"; focus now follows DOM order. Source fix: ${patch}`, fix };
    }

    case "duplicate-id": {
      const id = el.id;
      if (!id) return { ok: false, message: "This element has no id." };
      const fresh = `${id}-2`;
      const patch = `rename the second id="${id}" to id="${fresh}" and update its label[for]`;
      const fix = record(el, ruleId, "id", fresh, patch);
      el.id = fresh;
      // Re-point a label that was silently resolving to the first match. This
      // mutation must be RECORDED too, or revert restores the id and strands the
      // label pointing at a name that no longer exists.
      const orphan = Array.from(document.querySelectorAll(`label[for="${CSS.escape(id)}"]`)).pop();
      if (orphan && orphan.nextElementSibling === el) {
        record(orphan, ruleId, "for", fresh, patch);
        orphan.setAttribute("for", fresh);
      }
      return { ok: true, message: `Renamed duplicate id to "${fresh}". Source fix: ${patch}`, fix };
    }

    case "html-lang-missing": {
      const patch = `<html lang="en">`;
      const fix = record(document.documentElement, ruleId, "lang", "en", patch);
      document.documentElement.setAttribute("lang", "en");
      return { ok: true, message: `Set <html lang="en">. Source fix: ${patch}`, fix };
    }

    case "touch-target-small": {
      // WCAG 2.5.8 asks for 24x24 CSS px. Grow the box rather than the font, so
      // the label stays where the user already learned to look for it.
      const r = el.getBoundingClientRect();
      if (r.width >= 24 && r.height >= 24) {
        return { ok: false, message: "This target already meets the 24x24px minimum." };
      }
      const patch = `min-width: 24px; min-height: 24px;  /* was ${Math.round(r.width)}x${Math.round(r.height)}px */`;
      const fix = record(el, ruleId, "style", "min 24px", patch);
      const style = (el as HTMLElement).style;
      style.minWidth = "24px";
      style.minHeight = "24px";
      style.display = style.display || "inline-flex";
      style.alignItems = "center";
      style.justifyContent = "center";
      return {
        ok: true,
        message: `Enlarged the target from ${Math.round(r.width)}x${Math.round(r.height)}px to at least 24x24px. Source fix: ${patch}`,
        fix,
      };
    }

    default:
      return { ok: false, message: `No automatic fix available for rule "${ruleId}".` };
  }
}

/**
 * Undo every applied fix, restoring the page to its original defective state.
 *
 * Attributes are restored by VALUE rather than special-cased per rule: `record`
 * already captured the whole previous attribute string, so writing it back also
 * restores an inline style that carried more than one declaration. (An earlier
 * version cleared only `style.color`, which silently stranded any other
 * style-based repair.)
 */
export function revertFixes(): number {
  let count = 0;
  for (const fix of [...applied].reverse()) {
    const { el } = safeQuery(fix.selector);
    if (!el) continue;
    if (fix.previousValue === null) el.removeAttribute(fix.attribute);
    else el.setAttribute(fix.attribute, fix.previousValue);
    count++;
  }
  applied.length = 0;
  return count;
}

export function appliedFixes(): AppliedFix[] {
  return [...applied];
}
