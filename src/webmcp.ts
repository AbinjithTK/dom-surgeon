// WebMCP capability detection, diagnostics, and registration lifecycle.
// WebMCP requires an origin-isolated document and is gated by the `tools`
// Permissions Policy (defaults to `self`).

import type { ModelContext, WebMCPTool } from "../types/webmcp";
import { buildTools } from "./tools";

export type WebMCPState = "active" | "partial" | "no-api" | "not-isolated" | "policy-blocked" | "error";

export interface WebMCPStatus {
  state: WebMCPState;
  registered: string[];
  total: number;
  reason: string;
  advice: string;
}

function context(): ModelContext | undefined {
  // document.modelContext is the specified surface; navigator is a defensive fallback.
  return document.modelContext ?? navigator.modelContext;
}

function originIsolated(): boolean {
  // crossOriginIsolated is related but not identical; originAgentCluster is the
  // precise signal where implemented. Treat "undefined" as unknown, not false.
  const flag = (window as unknown as { originAgentCluster?: boolean }).originAgentCluster;
  return flag !== false;
}

function policyAllowsTools(): boolean {
  const pp = (document as unknown as {
    permissionsPolicy?: { allowsFeature?: (feature: string) => boolean };
  }).permissionsPolicy;
  try {
    if (pp && typeof pp.allowsFeature === "function") return pp.allowsFeature("tools");
  } catch { /* feature name unknown to this browser */ }
  return true; // unknown -> assume allowed, report the real error on registration
}

let controller: AbortController | null = null;

export async function registerAllTools(): Promise<WebMCPStatus> {
  const tools: WebMCPTool[] = buildTools();
  const total = tools.length;
  const mc = context();

  if (!mc || typeof mc.registerTool !== "function") {
    if (!originIsolated()) {
      return {
        state: "not-isolated", registered: [], total,
        reason: "This document is not origin-isolated, so WebMCP is disabled.",
        advice: "Remove the Origin-Agent-Cluster: ?0 header or any document.domain assignment.",
      };
    }
    return {
      state: "no-api", registered: [], total,
      reason: "document.modelContext is not present in this browser.",
      advice: "Open in ChatGPT's in-app browser, or Chrome 149+ with chrome://flags/#enable-webmcp-testing enabled.",
    };
  }

  if (!policyAllowsTools()) {
    return {
      state: "policy-blocked", registered: [], total,
      reason: "The `tools` Permissions Policy blocks registration in this context.",
      advice: 'If embedded in an iframe, add allow="tools" to the iframe element.',
    };
  }

  controller?.abort();
  controller = new AbortController();
  const registered: string[] = [];
  const failures: string[] = [];

  for (const tool of tools) {
    try {
      await mc.registerTool(tool, { signal: controller.signal });
      registered.push(tool.name);
    } catch (err) {
      failures.push(`${tool.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!registered.length) {
    return {
      state: "error", registered, total,
      reason: `Registration failed for all tools. ${failures[0] ?? ""}`.trim(),
      advice: "Check the browser console; the WebMCP API shape may have changed.",
    };
  }

  return {
    state: registered.length === total ? "active" : "partial",
    registered,
    total,
    reason: registered.length === total
      ? `All ${total} tools registered.`
      : `${registered.length} of ${total} tools registered. ${failures[0] ?? ""}`.trim(),
    advice: "",
  };
}

export function onToolChange(handler: () => void): void {
  const mc = context();
  if (mc && typeof mc.addEventListener === "function") {
    mc.addEventListener("toolchange", handler);
  }
}

export function toolNames(): string[] {
  return buildTools().map((t) => t.name);
}
