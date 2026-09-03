// Accessible name + role resolution: a practical subset of the ARIA
// accessible-name computation, evaluated against the LIVE (post-hydration) DOM.

const NAME_REQUIRED = new Set(["A", "BUTTON", "INPUT", "SELECT", "TEXTAREA"]);

/** Elements whose type never needs a name (they are not exposed as controls). */
const INPUT_NO_NAME = new Set(["hidden", "submit", "reset", "button", "image"]);

export function accessibleName(el: Element): string {
  // 1. aria-labelledby wins.
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    const text = labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  // 2. aria-label.
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return aria.trim();

  // 3. Native label association (for + wrapping).
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    const t = forLabel?.textContent?.trim();
    if (t) return t;
  }
  const wrapping = el.closest("label");
  if (wrapping) {
    const t = wrapping.textContent?.trim();
    if (t) return t;
  }

  // 4. Image alt.
  if (el.tagName === "IMG") {
    const alt = el.getAttribute("alt");
    if (alt !== null) return alt.trim();
  }

  // 5. Button/link/summary text content — but a glyph-only label
  //    (×, →, ✕) is not a usable name for assistive tech.
  if (["BUTTON", "A", "SUMMARY"].includes(el.tagName)) {
    const txt = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (txt && /\p{L}|\p{N}/u.test(txt)) return txt;
  }

  // 6. value= on button-like inputs.
  if (el instanceof HTMLInputElement && ["submit", "reset", "button"].includes(el.type)) {
    if (el.value.trim()) return el.value.trim();
  }

  // 7. title as last resort.
  const title = el.getAttribute("title");
  if (title?.trim()) return title.trim();

  return "";
}

export function role(el: Element): string {
  const explicit = el.getAttribute("role");
  if (explicit?.trim()) return explicit.trim().split(/\s+/)[0];

  if (el instanceof HTMLInputElement) {
    switch (el.type) {
      case "checkbox": return "checkbox";
      case "radio": return "radio";
      case "range": return "slider";
      case "button": case "submit": case "reset": return "button";
      case "number": return "spinbutton";
      case "search": return "searchbox";
      case "hidden": return "none";
      default: return "textbox";
    }
  }
  const map: Record<string, string> = {
    A: "link", BUTTON: "button", SELECT: "combobox", TEXTAREA: "textbox",
    IMG: "img", UL: "list", OL: "list", LI: "listitem", NAV: "navigation",
    MAIN: "main", HEADER: "banner", FOOTER: "contentinfo", FORM: "form",
    TABLE: "table", SECTION: "region", SUMMARY: "button",
    H1: "heading", H2: "heading", H3: "heading", H4: "heading", H5: "heading", H6: "heading",
  };
  if (el.tagName === "A" && !el.hasAttribute("href")) return "generic";
  return map[el.tagName] ?? "generic";
}

/** Does this element require an accessible name to be usable? */
export function requiresName(el: Element): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el instanceof HTMLInputElement && INPUT_NO_NAME.has(el.type)) return false;
  if (el.tagName === "A" && !el.hasAttribute("href")) return false;
  return NAME_REQUIRED.has(el.tagName);
}
