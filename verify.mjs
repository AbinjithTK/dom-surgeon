// Temporary combined verification — deleted after the run.
// 1. Self-audit: DOM-Surgeon's own chrome must be clean at body scope, while the
//    intentional #patient fixture keeps all its barriers.
// 2. Repair cycle: find -> repair -> revert must round-trip exactly.
import { chromium } from "playwright";

const url = process.argv[2];
const browser = await chromium.launch();
const fail = [];

// ---- 1. self audit
{
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: "load" });
  await page.addScriptTag({ url: "/dom-surgeon-engine.js" });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => {
    const res = window.DOMSurgeon.audit({ root: "body", level: "AA" });
    const inPatient = (s) => {
      try { return Boolean(document.querySelector(s)?.closest("#patient")); } catch { return false; }
    };
    const ours = res.findings.filter((f) => !inPatient(f.selector));
    return {
      ours: ours.map((f) => ({ ruleId: f.ruleId, selector: f.selector, summary: f.summary })),
      fixture: res.findings.length - ours.length,
    };
  });
  if (r.ours.length) fail.push(`self-audit: ${r.ours.length} defect(s) in our own UI`);
  if (r.fixture !== 6) fail.push(`fixture: expected 6 barriers, got ${r.fixture}`);
  console.log("SELF AUDIT  ours=" + r.ours.length + "  fixture=" + r.fixture);
  if (r.ours.length) console.log(JSON.stringify(r.ours, null, 2));
  await page.close();
}

// ---- 2. repair cycle
async function phase(clicks) {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(400);
  for (const c of clicks) { await page.click(c); await page.waitForTimeout(600); }
  const s = await page.evaluate(() => ({
    count: document.querySelector("#summary .score-value")?.textContent ?? null,
    note: document.querySelector(".repair-note-text")?.textContent ?? null,
    payColor: getComputedStyle(document.querySelector("#pay")).color,
    emailLabel: document.querySelector("#email")?.getAttribute("aria-label"),
    cardTabindex: document.querySelector("#card")?.getAttribute("tabindex"),
  }));
  await page.close();
  return { ...s, errors };
}

const found = await phase(["#run-audit"]);
const repaired = await phase(["#make-usable"]);
const round = await phase(["#make-usable", "#revert-fixes"]);

if (found.count !== "6") fail.push(`find: expected 6, got ${found.count}`);
if (repaired.count !== "0") fail.push(`repair: expected 0, got ${repaired.count}`);
if (round.count !== "6") fail.push(`revert: expected 6, got ${round.count}`);
if (round.payColor !== found.payColor) fail.push("revert: pay colour not restored");
if (round.cardTabindex !== "5") fail.push("revert: tabindex not restored");
if (repaired.emailLabel !== "Email address") fail.push("repair: email not named");
for (const p of [found, repaired, round]) if (p.errors.length) fail.push("page errors: " + p.errors[0]);

console.log("REPAIR CYCLE  find=" + found.count + " -> repair=" + repaired.count + " -> revert=" + round.count);
console.log("pay " + found.payColor + " -> " + repaired.payColor + " -> " + round.payColor);
console.log(fail.length ? "FAILURES:\n" + fail.join("\n") : "ALL CHECKS PASSED");

await browser.close();
process.exit(fail.length ? 1 : 0);
