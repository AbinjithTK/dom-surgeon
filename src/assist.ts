// Assistive layer — the beneficiary here is the PERSON the page is failing,
// not the developer reading a report.
//
// Everything below is deliberately session-scoped and non-persistent. Nothing is
// written back to the site, nothing is cached for the next visitor, and no claim
// is made about the site's conformance. This is last-mile relief for one user in
// one tab, which is the opposite of an "accessibility overlay" that mutates a
// page for everybody in order to sell the vendor a compliance badge.
//
// The developer-facing fix is still produced (see suggest_code_patch): the real
// repair belongs in the codebase, and helping the user now does not replace it.

import { runAudit, type Finding } from "./audit";
import { applyFix, type AppliedFix } from "./fixes";

/** Rules for which fixes.ts can perform a real repair on the live DOM. */
const REPAIRABLE = new Set([
  "name-missing",
  "image-alt-missing",
  "contrast-insufficient",
  "tabindex-positive",
  "duplicate-id",
  "touch-target-small",
  "html-lang-missing",
]);

/**
 * Plain-language translation of a finding, written for the person being blocked
 * rather than the engineer who will fix it. Deliberately says what the user will
 * EXPERIENCE, because "4.1.2 Name, Role, Value" tells a blind user nothing.
 */
export function barrierFor(f: Finding): string {
  switch (f.ruleId) {
    case "name-missing":
      return "A control your screen reader can only announce as an unlabelled text field — nothing tells you what belongs in it.";
    case "image-alt-missing":
      return "An image with no description, so your screen reader falls back to reading out a file name.";
    case "contrast-insufficient":
      return "Text too faint to read reliably — measured " + f.summary + ".";
    case "tabindex-positive":
      return "The Tab key jumps out of order here, so keyboard navigation skips past fields and lands somewhere unexpected.";
    case "duplicate-id":
      return "Two controls share one id, so the visible label is wired to the wrong field and your screen reader reads the wrong prompt.";
    case "touch-target-small":
      return "A control too small to hit reliably (" + f.summary + ") — easy to miss, and it sits next to a destructive action.";
    case "heading-order-skip":
      return "Heading levels skip a step, so jumping through the page by headings misrepresents how it is organised.";
    case "html-lang-missing":
      return "The page never declares its language, so speech synthesis may read it with the wrong pronunciation rules.";
    case "runtime-error":
      return "The page's own code crashed while this was in use, so an action you took failed without telling you.";
    default:
      return f.summary;
  }
}

export interface BarrierReport {
  total: number;
  blocking: number;
  lines: string[];
}

/** What is standing between this person and finishing the task, in their terms. */
export function describeBarriers(root?: string, level: "AA" | "AAA" = "AA"): BarrierReport {
  const result = runAudit({ root, level });
  const blocking = result.findings.filter(
    (f) => f.severity === "critical" || f.severity === "serious"
  );
  const lines = result.findings.map((f) => {
    const where = f.selector ? " (" + f.selector + ")" : "";
    const canFix = REPAIRABLE.has(f.ruleId) ? "" : " — needs a human to fix properly";
    return barrierFor(f) + where + canFix;
  });
  return { total: result.findings.length, blocking: blocking.length, lines };
}

export interface RepairSummary {
  attempted: number;
  repaired: AppliedFix[];
  skipped: { rule: string; why: string }[];
  remaining: Finding[];
  /** Plain-language account of what changed, for the user. */
  narrative: string;
}

/**
 * Repair everything repairable in one pass, then re-audit to prove it, and
 * report in language the affected person can act on.
 *
 * Ordering matters: duplicate-id is repaired FIRST because it re-points an
 * orphaned label, which can itself resolve a name-missing finding — fixing names
 * first would paper over the real cause with an aria-label.
 */
export function makePageUsable(root?: string, level: "AA" | "AAA" = "AA"): RepairSummary {
  const before = runAudit({ root, level });
  const ordered = [...before.findings].sort((a, b) => {
    const rank = (r: string) => (r === "duplicate-id" ? 0 : 1);
    return rank(a.ruleId) - rank(b.ruleId);
  });

  const repaired: AppliedFix[] = [];
  const skipped: { rule: string; why: string }[] = [];
  let attempted = 0;

  for (const f of ordered) {
    if (!f.selector || !REPAIRABLE.has(f.ruleId)) {
      skipped.push({ rule: f.ruleId, why: "no safe automatic repair — reported for a human" });
      continue;
    }
    attempted++;
    const outcome = applyFix(f.selector, f.ruleId);
    if (outcome.ok && outcome.fix) repaired.push(outcome.fix);
    else skipped.push({ rule: f.ruleId, why: outcome.message });
  }

  const after = runAudit({ root, level });

  return {
    attempted,
    repaired,
    skipped,
    remaining: after.findings,
    narrative: narrate(repaired, after.findings),
  };
}

function narrate(repaired: AppliedFix[], remaining: Finding[]): string {
  if (!repaired.length) {
    return remaining.length
      ? "Nothing here could be repaired automatically — every remaining barrier needs a person to fix it properly."
      : "Nothing needed repairing; this page is already usable by the checks available.";
  }

  const byRule = new Map<string, number>();
  repaired.forEach((f) => byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1));

  const plural = (n: number) => (n > 1 ? "s" : "");
  const phrase: Record<string, (n: number) => string> = {
    "name-missing": (n) => "named " + n + " control" + plural(n) + " your screen reader could not identify",
    "image-alt-missing": (n) => "described " + n + " image" + plural(n),
    "contrast-insufficient": (n) => "darkened " + n + " piece" + plural(n) + " of unreadable text",
    "tabindex-positive": (n) => "restored the keyboard tab order, removing " + n + " trap" + plural(n),
    "duplicate-id": (n) => "re-wired " + n + " label" + plural(n) + " that pointed at the wrong field",
    "touch-target-small": (n) => "enlarged " + n + " control" + plural(n) + " that were too small to hit",
    "html-lang-missing": () => "declared the page language so speech synthesis reads it correctly",
  };

  const did = [...byRule.entries()].map(([rule, n]) =>
    phrase[rule] ? phrase[rule](n) : "repaired " + n + " " + rule
  );

  const head = "I " + did.join("; ") + ".";
  const tail = remaining.length
    ? " " + remaining.length + " barrier" + plural(remaining.length) +
      " left that I should not fix silently — those need a person."
    : " Nothing blocking is left; you should be able to complete this now.";
  return head + tail;
}

// ------------------------------------------------------- reading preferences

export interface ReadingPreferences {
  /** Scale body text up. 1 = unchanged, 1.5 = 50 percent larger. */
  textScale?: number;
  /** Draw an unmissable focus ring, for keyboard-only navigation. */
  strongFocus?: boolean;
  /** Stop animation and transitions, for vestibular disorders and distraction. */
  reduceMotion?: boolean;
  /** Widen letter, word and line spacing, which measurably helps dyslexic readers. */
  readableSpacing?: boolean;
}

const STYLE_ID = "dom-surgeon-reading-prefs";
let active: ReadingPreferences = {};

/**
 * Apply reading accommodations to the live page.
 *
 * These are NOT audit findings — a page can pass every WCAG check and still be
 * unusable for a specific person. This is the half of accessibility that only
 * the individual can specify, which is exactly why it belongs in the tab with
 * them rather than in a vendor's CI pipeline.
 */
export function setReadingPreferences(prefs: ReadingPreferences): string {
  active = { ...active, ...prefs };
  const scale = Math.min(Math.max(active.textScale ?? 1, 1), 3);
  const rules: string[] = [];
  const applied: string[] = [];

  if (scale > 1) {
    // Scale the root font size so em and rem based layouts grow coherently.
    rules.push("html { font-size: " + Math.round(16 * scale) + "px; }");
    applied.push("text " + Math.round((scale - 1) * 100) + " percent larger");
  }
  if (active.strongFocus) {
    rules.push(
      "*:focus-visible { outline: 4px solid #ffd400 !important; outline-offset: 2px !important; " +
        "box-shadow: 0 0 0 7px rgba(0,0,0,.65) !important; }"
    );
    applied.push("high-visibility focus ring");
  }
  if (active.reduceMotion) {
    rules.push(
      "*, *::before, *::after { animation-duration: 0s !important; " +
        "animation-iteration-count: 1 !important; transition-duration: 0s !important; " +
        "scroll-behavior: auto !important; }"
    );
    applied.push("motion stopped");
  }
  if (active.readableSpacing) {
    // Thresholds taken from WCAG 1.4.12 Text Spacing, which content must survive.
    rules.push(
      "p, li, label, td, th, span, a, button, input, h1, h2, h3, h4 { " +
        "line-height: 1.6 !important; letter-spacing: 0.06em !important; word-spacing: 0.16em !important; }"
    );
    applied.push("wider letter and line spacing");
  }

  let tag = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!rules.length) {
    tag?.remove();
    return "Reading preferences cleared; the page is back to its own styling.";
  }
  if (!tag) {
    tag = document.createElement("style");
    tag.id = STYLE_ID;
    document.head.appendChild(tag);
  }
  tag.textContent = rules.join("\n");
  return "Applied: " + applied.join(", ") +
    ". This affects only your session — nothing is saved to the site.";
}

export function clearReadingPreferences(): string {
  active = {};
  document.getElementById(STYLE_ID)?.remove();
  return "Reading preferences cleared.";
}

export function currentReadingPreferences(): ReadingPreferences {
  return { ...active };
}
