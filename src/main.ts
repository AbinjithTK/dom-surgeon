import "./styles.css";
import { installConsoleRecorder, runAudit } from "./audit";
import { wireSubject } from "./patient";
import {
  publishFindings, clearHighlights, installOverlayTracking, exportReport,
} from "./render";
import { registerAllTools, onToolChange, toolNames, type WebMCPStatus } from "./webmcp";

// Install the recorder before anything else so early errors are captured.
installConsoleRecorder();

const byId = (id: string) => document.getElementById(id);

function currentOptions(): { root: string; level: "AA" | "AAA" } {
  const root = (byId("scope") as HTMLSelectElement | null)?.value || "#patient";
  const level = (byId("level") as HTMLSelectElement | null)?.value === "AAA" ? "AAA" : "AA";
  return { root, level };
}

/** Manual audit — the path that makes the app useful with no agent present. */
function runManualAudit(): void {
  const button = byId("run-audit") as HTMLButtonElement | null;
  try {
    if (button) { button.disabled = true; button.textContent = "Auditing…"; }
    const { root, level } = currentOptions();
    publishFindings(runAudit({ root, level }));
  } catch (err) {
    const host = byId("findings");
    if (host) {
      host.replaceChildren();
      const p = document.createElement("p");
      p.className = "diag-reason";
      p.textContent = `Audit failed: ${err instanceof Error ? err.message : String(err)}`;
      host.appendChild(p);
    }
  } finally {
    if (button) { button.disabled = false; button.textContent = "Run audit"; }
  }
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
      : "WebMCP unavailable · manual audit ready";
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
