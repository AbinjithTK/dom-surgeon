import type { WebMCPTool } from "../types/webmcp";
import {
  runAudit, a11yTree, consoleEntries, resolveScope,
  ruleContrast, ruleNameMissing, ruleImageAlt, type Finding,
} from "./audit";
import { cssPath, safeQuery, focusOrder, isVisible, tabbableElements } from "./dom";
import { accessibleName, role } from "./a11y";
import { effectiveBackground, contrastRatio, formatRatio, rgbaToCss, requiredRatio } from "./contrast";
import { publishFindings, highlight, clearHighlights, logToolCall } from "./render";
import { applyFix, revertFixes, appliedFixes } from "./fixes";

/** WebMCP recommends <=1.5K chars per tool output. Stay under it. */
const OUTPUT_BUDGET = 1400;

function cap(text: string): string {
  if (text.length <= OUTPUT_BUDGET) return text;
  return `${text.slice(0, OUTPUT_BUDGET - 60)}\n… truncated; narrow the scope for full detail.`;
}

/** Uniform error boundary: agents get an actionable string, never a rejection. */
function guard(name: string, fn: (input: Record<string, unknown>, ctx: { signal?: AbortSignal }) => string | Promise<string>) {
  return async (input: Record<string, unknown>, ctx: { signal?: AbortSignal }): Promise<string> => {
    logToolCall(name);
    try {
      return cap(await fn(input ?? {}, ctx ?? {}));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error in ${name}: ${message}`;
    }
  };
}

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function renderFindings(findings: Finding[], heading: string): string {
  if (!findings.length) return `${heading}: no issues found.`;
  const lines = findings.map(
    (f, i) => `${i + 1}. [${f.severity}] ${f.rule} — ${f.summary}${f.selector ? ` @ ${f.selector}` : ""}`
  );
  return `${heading}: ${findings.length} issue(s).\n${lines.join("\n")}`;
}

export function buildTools(): WebMCPTool[] {
  return [
    {
      name: "audit_page",
      description:
        "Run a full accessibility and reliability audit of the live rendered page. Checks accessible names, image alt text, colour contrast, keyboard focus order, duplicate ids, and runtime JS errors. Returns findings ranked by severity with WCAG references.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "CSS selector to scope the audit. Defaults to the demo page." },
          level: { type: "string", enum: ["AA", "AAA"], description: "WCAG conformance level. Default AA." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("audit_page", (input) => {
        const result = runAudit({ root: str(input, "root"), level: str(input, "level") === "AAA" ? "AAA" : "AA" });
        publishFindings(result);
        const { critical, serious, moderate, minor } = result.counts;
        const head = `Audited ${result.elementsScanned} elements in ${result.scope} at ${result.level}. ` +
          `${critical} critical, ${serious} serious, ${moderate} moderate, ${minor} minor.`;
        return renderFindings(result.findings, head);
      }),
    },

    {
      name: "find_contrast_failures",
      description:
        "Find text whose computed colour contrast fails WCAG. Uses the real rendered colours after the CSS cascade, composites translucent backgrounds, and applies the large-text 3:1 threshold. Returns each measured ratio.",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["AA", "AAA"], description: "Conformance level. Default AA." },
          root: { type: "string", description: "CSS selector to scope the scan." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("find_contrast_failures", (input) => {
        const level = str(input, "level") === "AAA" ? "AAA" : "AA";
        const root = resolveScope(str(input, "root"));
        const findings = ruleContrast(root, level);
        highlight(findings.map((f) => f.selector).filter(Boolean) as string[], "contrast");
        publishFindings({ findings, scope: str(input, "root") ?? "#patient", level });
        return renderFindings(findings, `Contrast scan (${level})`);
      }),
    },

    {
      name: "find_missing_labels",
      description:
        "List interactive controls and images that resolve to no accessible name, the most common screen-reader blocker. Runs the ARIA name computation against the live DOM, so placeholder-only inputs and icon-only buttons are correctly reported as unnamed.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "CSS selector to scope the scan." } },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("find_missing_labels", (input) => {
        const root = resolveScope(str(input, "root"));
        const findings = [...ruleNameMissing(root), ...ruleImageAlt(root)];
        highlight(findings.map((f) => f.selector).filter(Boolean) as string[], "issue");
        publishFindings({ findings, scope: str(input, "root") ?? "#patient", level: "AA" });
        return renderFindings(findings, "Accessible-name scan");
      }),
    },

    {
      name: "get_focus_order",
      description:
        "Return the real keyboard tab sequence. Excludes disabled, hidden, aria-hidden and tabindex=-1 elements, and applies the positive-tabindex-first rule, so the order matches what a keyboard user actually experiences.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "CSS selector to scope the scan." } },
      },
      annotations: { readOnlyHint: true },
      execute: guard("get_focus_order", (input) => {
        const root = resolveScope(str(input, "root"));
        const dom = tabbableElements(root);
        const order = focusOrder(root);
        const reordered = order.some((el, i) => el !== dom[i]);
        highlight(order.map((e) => cssPath(e)), "focus");
        const lines = order.map((el, i) => {
          const ti = el.getAttribute("tabindex");
          const name = accessibleName(el) || "(unnamed)";
          return `${i + 1}. ${cssPath(el)} — ${name}${ti ? ` [tabindex=${ti}]` : ""}`;
        });
        return `${order.length} tabbable element(s). Focus order ${
          reordered ? "DOES NOT match DOM order (positive tabindex present)" : "matches DOM order"
        }.\n${lines.join("\n")}`;
      }),
    },

    {
      name: "get_a11y_tree",
      description:
        "Return the accessibility tree of the live page as the browser exposes it after JavaScript hydration: role, accessible name, and a unique selector per node. Depth-capped to stay concise.",
      inputSchema: {
        type: "object",
        properties: {
          root: { type: "string", description: "CSS selector to scope the tree." },
          depth: { type: "number", description: "Max depth, 1-6. Default 4." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("get_a11y_tree", (input) => {
        const root = resolveScope(str(input, "root"));
        const depth = Math.min(Math.max(Number(input.depth) || 4, 1), 6);
        const tree = a11yTree(root, depth);
        const lines: string[] = [];
        const walk = (n: ReturnType<typeof a11yTree>, d: number) => {
          lines.push(`${"  ".repeat(d)}${n.role}${n.name ? ` "${n.name.slice(0, 40)}"` : " (no name)"} <${n.tag}>`);
          n.children?.forEach((c) => walk(c, d + 1));
        };
        walk(tree, 0);
        return lines.join("\n");
      }),
    },

    {
      name: "describe_element",
      description:
        "Deep-inspect one element by CSS selector: role, accessible name, computed colours and contrast ratio, box geometry, tab position, and a remediation hint when it has a problem.",
      inputSchema: {
        type: "object",
        properties: { selector: { type: "string", description: "CSS selector of the element to inspect." } },
        required: ["selector"],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("describe_element", (input) => {
        const selector = str(input, "selector");
        if (!selector) return "Provide a 'selector' argument.";
        const { el, error } = safeQuery(selector);
        if (error) return error;
        if (!el) return `No element matches ${selector}.`;
        const style = getComputedStyle(el);
        const bg = effectiveBackground(el);
        const ratio = contrastRatio(style.color, bg);
        const need = requiredRatio(style, "AA");
        const box = el.getBoundingClientRect();
        const name = accessibleName(el);
        highlight([selector], "issue");
        return [
          `${el.tagName.toLowerCase()} — role "${role(el)}"`,
          `accessible name: ${name || "(none)"}`,
          `colour: ${style.color} on ${rgbaToCss(bg)} = ${formatRatio(ratio)} (needs ${formatRatio(need)})`,
          `font: ${style.fontSize} / weight ${style.fontWeight}`,
          `box: ${Math.round(box.width)}x${Math.round(box.height)} at ${Math.round(box.x)},${Math.round(box.y)}`,
          `tabindex: ${el.getAttribute("tabindex") ?? "(none)"} · visible: ${isVisible(el)}`,
          !name ? `FIX: add a label or aria-label so assistive tech can name this control.` : "",
          ratio < need ? `FIX: raise contrast to at least ${formatRatio(need)}.` : "",
        ].filter(Boolean).join("\n");
      }),
    },

    {
      name: "get_console_log",
      description:
        "Return JavaScript errors and warnings captured in this browsing session, including uncaught exceptions and unhandled promise rejections. These exist only in the live tab and cannot be read from outside the page.",
      inputSchema: {
        type: "object",
        properties: {
          level: { type: "string", enum: ["error", "warn", "all"], description: "Filter. Default error." },
        },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("get_console_log", (input) => {
        const level = (str(input, "level") ?? "error") as "error" | "warn" | "all";
        const entries = consoleEntries(level);
        if (!entries.length) return `No console entries at level "${level}".`;
        return `${entries.length} entry(ies):\n${entries
          .slice(-15)
          .map((e) => `[${e.level}] ${e.message}`)
          .join("\n")}`;
      }),
    },

    {
      name: "reproduce_interaction",
      description:
        "Replay a sequence of steps (click, type, focus) on the live page and report what broke: new JS errors, whether focus actually moved, and any status text the page rendered. Reproduces a bug on the real DOM rather than describing it.",
      inputSchema: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "Ordered steps, each {action, selector, value?}.",
            items: {
              type: "object",
              properties: {
                action: { type: "string", enum: ["click", "type", "focus"] },
                selector: { type: "string", description: "Target element selector." },
                value: { type: "string", description: "Text to enter, for the type action." },
              },
              required: ["action", "selector"],
            },
          },
        },
        required: ["steps"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: guard("reproduce_interaction", async (input, ctx) => {
        const steps = Array.isArray(input.steps) ? input.steps : [];
        if (!steps.length) return "Provide at least one step.";
        const before = consoleEntries("error").length;
        const log: string[] = [];

        for (const [i, raw] of steps.entries()) {
          if (ctx.signal?.aborted) return `Aborted after ${i} step(s).\n${log.join("\n")}`;
          const step = raw as { action?: string; selector?: string; value?: string };
          if (!step.selector || !step.action) { log.push(`${i + 1}. skipped: missing action/selector`); continue; }
          const { el, error } = safeQuery(step.selector);
          if (error) { log.push(`${i + 1}. ${error}`); continue; }
          if (!el) { log.push(`${i + 1}. ${step.action} ${step.selector} → no such element`); continue; }
          const target = el as HTMLElement;
          try {
            if (step.action === "click") target.click();
            else if (step.action === "focus") target.focus();
            else if (step.action === "type") {
              (target as HTMLInputElement).value = step.value ?? "";
              target.dispatchEvent(new Event("input", { bubbles: true }));
              target.dispatchEvent(new Event("change", { bubbles: true }));
            }
            await new Promise((r) => setTimeout(r, 40));
            const focusNote = step.action === "focus"
              ? ` (focus ${document.activeElement === target ? "moved" : "DID NOT move"})`
              : "";
            log.push(`${i + 1}. ${step.action} ${step.selector} → ok${focusNote}`);
          } catch (err) {
            log.push(`${i + 1}. ${step.action} ${step.selector} → threw ${(err as Error).message}`);
          }
        }

        const newErrors = consoleEntries("error").slice(before);
        const status = document.getElementById("pay-status")?.textContent?.trim();
        return [
          log.join("\n"),
          newErrors.length ? `\nNew runtime errors:\n${newErrors.map((e) => `- ${e.message}`).join("\n")}` : "\nNo new runtime errors.",
          status ? `Page status: ${status}` : "",
        ].filter(Boolean).join("\n");
      }),
    },

    {
      name: "apply_fix",
      description:
        "Repair one finding on the live page so the human can see the corrected state immediately, and return the equivalent source-code change. Handles missing names, missing alt text, low contrast, positive tabindex, duplicate ids, and a missing document language. Reversible with revert_fixes.",
      inputSchema: {
        type: "object",
        properties: {
          selector: { type: "string", description: "CSS selector of the element to repair." },
          ruleId: {
            type: "string",
            enum: ["name-missing", "image-alt-missing", "contrast-insufficient", "tabindex-positive", "duplicate-id", "html-lang-missing"],
            description: "Which finding to fix.",
          },
        },
        required: ["selector", "ruleId"],
      },
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: guard("apply_fix", (input) => {
        const selector = str(input, "selector");
        const ruleId = str(input, "ruleId");
        if (!selector || !ruleId) return "Provide both 'selector' and 'ruleId'.";
        const outcome = applyFix(selector, ruleId);
        if (outcome.ok) {
          highlight([selector], "focus");
          logToolCall("apply_fix ✓");
        }
        return `${outcome.ok ? "FIXED" : "NOT APPLIED"}: ${outcome.message}\nRe-run audit_page to confirm the finding is cleared.`;
      }),
    },

    {
      name: "revert_fixes",
      description:
        "Undo every fix applied in this session, restoring the page to its original state. Useful for demonstrating a before/after comparison.",
      inputSchema: { type: "object", properties: {} },
      annotations: { readOnlyHint: false },
      execute: guard("revert_fixes", () => {
        const count = revertFixes();
        clearHighlights();
        return count ? `Reverted ${count} fix(es); the page is back to its original state.` : "No fixes to revert.";
      }),
    },

    {
      name: "suggest_code_patch",
      description:
        "Return the source-level changes for the current findings, as a copy-pasteable list, so a developer or a coding agent can apply them in the codebase rather than only in the live DOM.",
      inputSchema: {
        type: "object",
        properties: { root: { type: "string", description: "CSS selector to scope the audit." } },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: guard("suggest_code_patch", (input) => {
        const result = runAudit({ root: str(input, "root"), level: "AA" });
        if (!result.findings.length) return "No findings, so no patches needed.";
        const lines = result.findings.map(
          (f, i) => `${i + 1}. ${f.selector ?? "(page)"} [${f.ruleId}]\n   ${f.fix}`
        );
        const alreadyApplied = appliedFixes();
        const suffix = alreadyApplied.length
          ? `\n\nAlready applied live (${alreadyApplied.length}): ${alreadyApplied.map((a) => `${a.selector} ${a.attribute}`).join(", ")}`
          : "";
        return `Source changes for ${result.findings.length} finding(s):\n${lines.join("\n")}${suffix}`;
      }),
    },

    {
      name: "highlight_elements",
      description:
        "Draw or clear visual highlight overlays on the page so the human sees exactly which elements a finding refers to. Overlays track the elements as the page scrolls.",
      inputSchema: {
        type: "object",
        properties: {
          selectors: { type: "array", items: { type: "string" }, description: "Selectors to outline." },
          clear: { type: "boolean", description: "Clear all overlays instead of drawing." },
        },
      },
      annotations: { readOnlyHint: false },
      execute: guard("highlight_elements", (input) => {
        if (input.clear === true) { clearHighlights(); return "Cleared all overlays."; }
        const selectors = Array.isArray(input.selectors) ? input.selectors.filter((s): s is string => typeof s === "string") : [];
        if (!selectors.length) return "Provide 'selectors' or set clear=true.";
        const drawn = highlight(selectors, "issue");
        return `Highlighted ${drawn} of ${selectors.length} selector(s).${
          drawn < selectors.length ? " Unmatched selectors were skipped." : ""
        }`;
      }),
    },
  ];
}
