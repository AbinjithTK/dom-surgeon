import "./styles.css";
import { installConsoleRecorder, runAudit } from "./audit";
import { wireSubject } from "./patient";
import {
  publishFindings, clearHighlights, installOverlayTracking, exportReport, announce,
} from "./render";
import { makePageUsable, barrierFor } from "./assist";
import { revertFixes } from "./fixes";
import { registerAllTools, onToolChange, toolNames, type WebMCPStatus } from "./webmcp";

// Install the recorder before anything else so early errors are captured.
installConsoleRecorder();

const byId = (id: string) => document.getElementById(id);

function currentOptions(): { root: string; level: "AA" | "AAA" } {
  const root = (byId("scope") as HTMLSelectElement | null)?.value || "#patient";
  const level = (byId("level") as HTMLSelectElement | null)?.value === "AAA" ? "AAA" : "AA";
  return { root, level };
}

/** Find barriers — the path that makes the app useful with no agent present. */
function runManualAudit(): void {
  const button = byId("run-audit") as HTMLButtonElement | null;
  try {
    if (button) { button.disabled = true; button.textContent = "Checking…"; }
    const { root, level } = currentOptions();
    const result = runAudit({ root, level });
    publishFindings(result);
    if (!result.findings.length) return;
    const blocking = result.findings.filter(
      (f) => f.severity === "critical" || f.severity === "serious"
    );
    announce(
      blocking.length
        ? `${blocking.length} of ${result.findings.length} barriers here are likely to stop you finishing. The worst: ${barrierFor(blocking[0])}`
        : `${result.findings.length} minor barrier(s) found — none of them should stop you completing the task.`,
      "info"
    );
  } catch (err) {
    reportFailure(err);
  } finally {
    if (button) { button.disabled = false; button.textContent = "Find barriers"; }
  }
}

/**
 * Repair the page for the person in front of it. This is the whole point of the
 * product, so it must work without WebMCP too — an agent is a nicer way to reach
 * it, not the only way.
 */
function runMakeUsable(): void {
  const button = byId("make-usable") as HTMLButtonElement | null;
  try {
    if (button) { button.disabled = true; button.textContent = "Repairing…"; }
    const { root, level } = currentOptions();
    const summary = makePageUsable(root, level);
    publishFindings(runAudit({ root, level }));
    announce(summary.narrative);
  } catch (err) {
    reportFailure(err);
  } finally {
    if (button) { button.disabled = false; button.textContent = "Make this page usable"; }
  }
}

/** Restore the original defective state, so before/after is one click apart. */
function runRevert(): void {
  try {
    const count = revertFixes();
    const { root, level } = currentOptions();
    publishFindings(runAudit({ root, level }));
    announce(
      count
        ? `Undid ${count} repair${count > 1 ? "s" : ""}; the page is back to how the site ships it.`
        : "There were no repairs to undo.",
      "info"
    );
  } catch (err) {
    reportFailure(err);
  }
}

function reportFailure(err: unknown): void {
  const host = byId("findings");
  if (!host) return;
  host.replaceChildren();
  const p = document.createElement("p");
  p.className = "diag-reason";
  p.textContent = `Failed: ${err instanceof Error ? err.message : String(err)}`;
  host.appendChild(p);
}

function paintStatus(status: WebMCPStatus): void {
  const badge = byId("mcp-badge");
  const reason = byId("mcp-reason");
  const advice = byId("mcp-advice");
  const count = byId("tool-count");
  const total = byId("tool-total");
  const list = byId("tool-list");

  const active = status.state === "active" || status.state === "partial";
  if (badge) {
    badge.textContent = active
      ? `WebMCP active · ${status.registered.length}/${status.total} tools`
      : "No agent here — you can still repair the page yourself";
    badge.className = `badge ${active ? "badge--active" : "badge--off"}`;
  }
  if (reason) reason.textContent = status.reason;
  if (advice) advice.textContent = status.advice;
  // Honest counts: 0 when nothing registered (v1 displayed the total regardless).
  if (count) count.textContent = String(status.registered.length);
  if (total) total.textContent = String(status.total);

  if (list) {
    list.replaceChildren();
    const names = status.registered.length ? status.registered : toolNames();
    names.forEach((name) => {
      const li = document.createElement("li");
      li.textContent = status.registered.length ? name : `${name} (not registered)`;
      list.appendChild(li);
    });
  }
}

function wireControls(): void {
  byId("run-audit")?.addEventListener("click", runManualAudit);
  byId("make-usable")?.addEventListener("click", runMakeUsable);
  byId("revert-fixes")?.addEventListener("click", runRevert);
  byId("export-report")?.addEventListener("click", exportReport);
  byId("clear-overlays")?.addEventListener("click", clearHighlights);
  byId("scope")?.addEventListener("change", runManualAudit);
  byId("level")?.addEventListener("change", runManualAudit);
}

/**
 * The Integrate panel is the distribution surface: it turns this sandbox into a
 * launch point for auditing the visitor's OWN app, which is the only way the
 * engine reaches a page anyone cares about (same-origin policy).
 */
function wireIntegrate(): void {
  const engineUrl = new URL("dom-surgeon-engine.js", location.href).toString();

  const tag = byId("snip-tag");
  if (tag) tag.textContent = `<script src="${engineUrl}"><\/script>`;

  // Bookmarklet: inject the engine, then print a report to the console.
  const code =
    `javascript:(function(){var s=document.createElement('script');` +
    `s.src='${engineUrl}';s.onload=function(){window.DOMSurgeon.report({root:'body'})};` +
    `document.body.appendChild(s)})()`;
  const link = byId("bookmarklet") as HTMLAnchorElement | null;
  if (link) {
    link.href = code;
    link.addEventListener("click", (e) => e.preventDefault());
  }
  const hidden = byId("snip-bm");
  if (hidden) hidden.textContent = code;

  document.querySelectorAll<HTMLButtonElement>("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const target = byId(btn.dataset.copy || "");
      if (!target?.textContent) return;
      const original = btn.textContent;
      try {
        await navigator.clipboard.writeText(target.textContent);
        btn.textContent = "Copied";
      } catch {
        btn.textContent = "Copy failed — select manually";
      }
      window.setTimeout(() => { btn.textContent = original; }, 1600);
    });
  });
}

async function main(): Promise<void> {
  wireSubject();
  wireControls();
  wireIntegrate();
  installOverlayTracking();

  const status = await registerAllTools();
  paintStatus(status);
  onToolChange(() => { void registerAllTools().then(paintStatus); });
}

void main();
