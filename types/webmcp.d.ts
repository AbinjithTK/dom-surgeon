// Types for the experimental WebMCP Imperative API.
// Source: https://developer.chrome.com/docs/ai/webmcp/imperative-api (Aug 2026).
// NOTE: `execute` returns a plain STRING in WebMCP (unlike server-side MCP,
// which returns a content array). Verified against all official examples.

export interface WebMCPAnnotations {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
}

export type WebMCPExecute = (
  input: Record<string, unknown>,
  context: { signal?: AbortSignal }
) => Promise<string> | string;

export interface WebMCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: WebMCPAnnotations;
  execute: WebMCPExecute;
}

export interface RegisterToolOptions {
  /** Aborting this signal unregisters the tool. */
  signal?: AbortSignal;
  /** Secure origins allowed to see/execute this tool. */
  exposedTo?: string[];
}

export interface ModelContext extends EventTarget {
  registerTool(tool: WebMCPTool, options?: RegisterToolOptions): Promise<void>;
  getTools?(options?: { fromOrigins?: string[] }): Promise<unknown[]>;
  executeTool?(
    tool: unknown,
    argsJson: string,
    options?: { signal?: AbortSignal }
  ): Promise<string | null>;
}

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    // Not in the specification; retained only as a defensive fallback.
    modelContext?: ModelContext;
  }
}

export {};
