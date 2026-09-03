// Standalone engine entry point.
//
// This bundle contains ONLY the audit engine — no UI, no WebMCP registration —
// so it can be injected into ANY page: the developer's dev server (via the CLI
// and Playwright), an arbitrary page (via the bookmarklet), or a test runner.
//
// The engine is the product. WebMCP and the CLI are two front-ends to it.

import {
  runAudit, installConsoleRecorder, consoleEntries,
  SEVERITY_ORDER, type AuditResult, type Finding, type Severity,
} from "./audit";

const VERSION = "2.0.0";

export interface AuditRequest {
  /** CSS selector to scope the audit. Defaults to document.body. */
  root?: string;
  level?: "AA" | "AAA";
}

export interface BaselineDiff {
  added: Finding[];
  fixed: Finding[];
  unchanged: number;
}

/** Stable identity for a finding, used for baseline diffing. */
function fingerprint(f: Finding): string {
  return `${f.ruleId}::${f.selector ?? "-"}::${f.summary}`;
}

function audit(request: AuditRequest = {}): AuditResult {
  return runAudit({ root: request.root ?? "body", level: request.level ?? "AA" });
}

/** Compare a fresh audit against a saved baseline: only NEW findings matter. */
function diff(baseline: Finding[], current?: Finding[]): BaselineDiff {
  const now = current ?? audit().findings;
  const before = new Set(baseline.map(fingerprint));
  const after = new Set(now.map(fingerprint));
  return {
    added: now.filter((f) => !before.has(fingerprint(f))),
    fixed: baseline.filter((f) => !after.has(fingerprint(f))),
    unchanged: now.filter((f) => before.has(fingerprint(f))).length,
  };
}

/** Agent-friendly plain-text report: compact, actionable, no ANSI. */
function toText(result: AuditResult): string {
  if (!result.findings.length) {
    return `PASS — no issues in ${result.scope} at WCAG ${result.level} (${result.elementsScanned} elements).`;
  }
  const head =
    `${result.findings.length} issue(s) in ${result.scope} at WCAG ${result.level} — ` +
    SEVERITY_ORDER.map((s) => `${result.counts[s]} ${s}`).join(", ");
  const body = result.findings
    .map(
      (f, i) =>
        `\n${i + 1}. [${f.severity.toUpperCase()}] ${f.rule}` +
        `\n   where: ${f.selector ?? "(page-level)"}` +
        `\n   what:  ${f.summary}` +
        (f.wcag ? `\n   spec:  ${f.wcag}` : "") +
        `\n   fix:   ${f.fix}`
    )
    .join("");
  return head + body;
}

/** Markdown for a PR comment or a design-review paste. */
function toMarkdown(result: AuditResult): string {
  if (!result.findings.length) return `**DOM-Surgeon:** no issues found (WCAG ${result.level}).`;
  const rows = result.findings
    .map((f) => `| ${f.severity} | ${f.rule} | \`${f.selector ?? "-"}\` | ${f.summary} | ${f.fix} |`)
    .join("\n");
  return [
    `**DOM-Surgeon** — ${result.findings.length} issue(s), WCAG ${result.level}`,
    "",
    "| Severity | Rule | Selector | Detail | Fix |",
    "| --- | --- | --- | --- | --- |",
    rows,
  ].join("\n");
}

/** Highest severity present, for exit-code decisions. */
function worstSeverity(findings: Finding[]): Severity | null {
  for (const s of SEVERITY_ORDER) if (findings.some((f) => f.severity === s)) return s;
  return null;
}

/** Convenience for the bookmarklet: audit and print to the console. */
function report(request: AuditRequest = {}): AuditResult {
  const result = audit(request);
  // eslint-disable-next-line no-console
  console.log(`%cDOM-Surgeon v${VERSION}`, "font-weight:bold", `\n${toText(result)}`);
  return result;
}

installConsoleRecorder();

const DOMSurgeon = {
  VERSION,
  audit,
  diff,
  report,
  toText,
  toMarkdown,
  worstSeverity,
  consoleEntries,
};

// Expose on the page so Playwright / the bookmarklet / any script can call it.
// The IIFE wrapper also assigns this object to window.DOMSurgeon (via
// output.exports: "default"), so both paths land on the same API surface.
(window as unknown as { DOMSurgeon: typeof DOMSurgeon }).DOMSurgeon = DOMSurgeon;

export default DOMSurgeon;
