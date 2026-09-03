// WCAG 2.x contrast computation on computed styles.

type RGBA = [number, number, number, number];

function parseColor(color: string): RGBA {
  const m = color.match(/rgba?\(([^)]+)\)/i);
  if (!m) return [255, 255, 255, 1];
  const p = m[1].split(/[,/]/).map((v) => Number.parseFloat(v.trim()));
  return [p[0] || 0, p[1] || 0, p[2] || 0, Number.isFinite(p[3]) ? p[3] : 1];
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function composite(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3];
  if (a >= 1) return fg;
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
    1,
  ];
}

function relativeLuminance([r, g, b]: RGBA): number {
  const lin = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

/** Walk ancestors to the first opaque background, compositing translucent layers. */
export function effectiveBackground(el: Element): RGBA {
  const stack: RGBA[] = [];
  let node: Element | null = el;
  while (node) {
    const c = parseColor(getComputedStyle(node).backgroundColor);
    if (c[3] > 0) {
      stack.push(c);
      if (c[3] >= 1) break;
    }
    node = node.parentElement;
  }
  let base: RGBA = [255, 255, 255, 1];
  for (let i = stack.length - 1; i >= 0; i--) base = composite(stack[i], base);
  return base;
}

export function contrastRatio(fgColor: string, bg: RGBA): number {
  const fg = composite(parseColor(fgColor), bg);
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG large text: >= 24px, or >= 18.66px when bold (>=700).
 * Large text needs only 3:1 at AA; normal text needs 4.5:1.
 * (v1 omitted this rule and produced false positives on headings.)
 */
export function isLargeText(style: CSSStyleDeclaration): boolean {
  const px = Number.parseFloat(style.fontSize) || 16;
  const weight = Number.parseInt(style.fontWeight, 10) || 400;
  return px >= 24 || (px >= 18.66 && weight >= 700);
}

export function requiredRatio(style: CSSStyleDeclaration, level: "AA" | "AAA"): number {
  const large = isLargeText(style);
  if (level === "AAA") return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}

export function formatRatio(r: number): string {
  return `${Math.round(r * 100) / 100}:1`;
}

export function rgbaToCss([r, g, b]: RGBA): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}
