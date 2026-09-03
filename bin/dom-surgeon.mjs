#!/usr/bin/env node
/**
 * DOM-Surgeon CLI — closes the feedback loop for AI coding agents.
 *
 *   npx dom-surgeon audit http://localhost:5173
 *   npx dom-surgeon audit http://localhost:5173 --json
 *   npx dom-surgeon audit http://localhost:5173 /checkout /settings
 *   npx dom-surgeon audit http://localhost:5173 --fail-on critical
 *   npx dom-surgeon audit http://localhost:5173 --baseline a11y-baseline.json
 *
 * Exit codes:  0 = clean (or below threshold)   1 = findings at/above --fail-on
 *              2 = usage / runtime error
 *
 * The audit engine is plain DOM JavaScript, so it is injected into the target
 * page with Playwright. This is NOT WebMCP: WebMCP is the in-page, human-in-the-
 * loop front-end. Same engine, different surface.
 */

import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, "..", "public", "dom-surgeon-engine.js");

const SEVERITIES = ["critical", "serious", "moderate", "minor"];

function usage(message) {
  if (message) console.error(`error: ${message}\n`);
  console.error(`DOM-Surgeon — runtime accessibility auditor

usage:
  dom-surgeon audit <base-url> [path...] [options]

options:
  --json                 machine-readable output (for agents / CI)
  --markdown             markdown table (for PR comments)
  --level AA|AAA         WCAG level (default AA)
  --scope <selector>     CSS selector to audit (default body)
  --fail-on <severity>   exit 1 at/above this severity: critical|serious|moderate|minor
  --baseline <file>      compare against a saved baseline; only NEW findings fail
  --save-baseline <file> write the current findings as a baseline and exit 0
  --timeout <ms>         page load timeout (default 15000)
  --wait <ms>            settle delay after load, for hydration (default 500)

examples:
  dom-surgeon audit http://localhost:5173 --json
  dom-surgeon audit http://localhost:3000 / /checkout --fail-on critical
`);
  process.exit(message ? 2 : 0);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h") usage();
  if (command !== "audit") usage(`unknown command "${command}"`);

  const opts = {
    level: "AA", scope: "body", json: false, markdown: false,
    failOn: null, baseline: null, saveBaseline: null, timeout: 15000, wait: 500,
    base: null, paths: [],
  };

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    const next = () => {
      const v = rest[++i];
      if (v === undefined) usage(`${a} requires a value`);
      return v;
    };
    if (a === "--json") opts.json = true;
    else if (a === "--markdown") opts.markdown = true;
    else if (a === "--level") opts.level = next().toUpperCase() === "AAA" ? "AAA" : "AA";
    else if (a === "--scope") opts.scope = next();
    else if (a === "--fail-on") {
      opts.failOn = next().toLowerCase();
      if (!SEVERITIES.includes(opts.failOn)) usage(`--fail-on must be one of ${SEVERITIES.join("|")}`);
    } else if (a === "--baseline") opts.baseline = next();
    else if (a === "--save-baseline") opts.saveBaseline = next();
    else if (a === "--timeout") opts.timeout = Number(next()) || 15000;
    else if (a === "--wait") opts.wait = Number(next()) || 0;
    else if (a.startsWith("--")) usage(`unknown option ${a}`);
    else if (!opts.base) opts.base = a;
    else opts.paths.push(a);
  }

  if (!opts.base) usage("a base URL is required");
  if (!opts.paths.length) opts.paths.push("");
  return opts;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    try {
      return await import("playwright-core");
    } catch {
      console.error(
        `DOM-Surgeon needs Playwright to load your page.\n\n` +
        `  npm i -D playwright && npx playwright install chromium\n\n` +
        `(The in-page WebMCP front-end needs no such dependency; this is only for the CLI.)`
      );
      process.exit(2);
    }
  }
}

function severityAtOrAbove(findings, threshold) {
  const limit = SEVERITIES.indexOf(threshold);
  return findings.filter((f) => SEVERITIES.indexOf(f.severity) <= limit);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  if (!existsSync(ENGINE)) {
    console.error(`Engine bundle missing at ${ENGINE}\nRun: npm run build:engine`);
    process.exit(2);
  }
  const engineSource = readFileSync(ENGINE, "utf8");

  const { chromium } = await loadPlaywright();
  let browser;
  try {
    browser = await chromium.launch();
  } catch (err) {
    const message = String(err?.message || err);
    if (/Executable doesn't exist|please run|browserType\.launch/i.test(message)) {
      console.error(
        `Playwright is installed but its browser binary is missing.\n\n` +
        `  npx playwright install chromium\n`
      );
      process.exit(2);
    }
    throw err;
  }
  const context = await browser.newContext();
  const page = await context.newPage();

  const runs = [];
  try {
    for (const path of opts.paths) {
      const url = path ? new URL(path, opts.base).toString() : opts.base;
      try {
        await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeout });
      } catch {
        // networkidle can never settle on apps with long-polling; fall back.
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: opts.timeout });
      }
      if (opts.wait) await page.waitForTimeout(opts.wait);

      // Inject the engine into the page and run it there, so every measurement
      // comes from the real rendered DOM after hydration.
      await page.addScriptTag({ content: engineSource });
      const result = await page.evaluate(
        ([scope, level]) => window.DOMSurgeon.audit({ root: scope, level }),
        [opts.scope, opts.level]
      );
      runs.push({ url, ...result });
    }
  } finally {
    await browser.close();
  }

  const allFindings = runs.flatMap((r) => r.findings.map((f) => ({ ...f, url: r.url })));

  if (opts.saveBaseline) {
    writeFileSync(resolve(opts.saveBaseline), JSON.stringify(allFindings, null, 2));
    console.log(`Baseline written: ${opts.saveBaseline} (${allFindings.length} finding(s)).`);
    process.exit(0);
  }

  let gated = allFindings;
  let diffNote = "";
  if (opts.baseline) {
    const prior = JSON.parse(readFileSync(resolve(opts.baseline), "utf8"));
    const key = (f) => `${f.ruleId}::${f.selector ?? "-"}::${f.summary}`;
    const before = new Set(prior.map(key));
    const added = allFindings.filter((f) => !before.has(key(f)));
    const fixed = prior.filter((f) => !new Set(allFindings.map(key)).has(key(f)));
    diffNote = `Baseline diff: ${added.length} new, ${fixed.length} fixed, ${allFindings.length - added.length} pre-existing.`;
    gated = added;
  }

  if (opts.json) {
    console.log(JSON.stringify({
      version: 2,
      level: opts.level,
      scope: opts.scope,
      runs: runs.map((r) => ({ url: r.url, counts: r.counts, elementsScanned: r.elementsScanned })),
      findings: allFindings,
      gatedFindings: gated,
      baselineDiff: opts.baseline ? diffNote : null,
    }, null, 2));
  } else if (opts.markdown) {
    if (!gated.length) console.log("**DOM-Surgeon:** no new issues.");
    else {
      console.log(`**DOM-Surgeon** — ${gated.length} issue(s), WCAG ${opts.level}\n`);
      console.log("| Severity | Rule | Selector | Detail | Fix |");
      console.log("| --- | --- | --- | --- | --- |");
      gated.forEach((f) =>
        console.log(`| ${f.severity} | ${f.rule} | \`${f.selector ?? "-"}\` | ${f.summary} | ${f.fix} |`)
      );
    }
  } else {
    runs.forEach((r) => {
      const c = r.counts;
      console.log(`\n${r.url} — ${r.findings.length} issue(s) ` +
        `[${c.critical} critical, ${c.serious} serious, ${c.moderate} moderate, ${c.minor} minor]`);
      r.findings.forEach((f, i) => {
        console.log(`  ${i + 1}. [${f.severity.toUpperCase()}] ${f.rule}`);
        console.log(`     where: ${f.selector ?? "(page-level)"}`);
        console.log(`     what:  ${f.summary}`);
        if (f.wcag) console.log(`     spec:  ${f.wcag}`);
        console.log(`     fix:   ${f.fix}`);
      });
    });
    if (diffNote) console.log(`\n${diffNote}`);
    if (!allFindings.length) console.log("\nPASS — no issues found.");
  }

  if (opts.failOn) {
    const breaching = severityAtOrAbove(gated, opts.failOn);
    if (breaching.length) {
      if (!opts.json) console.error(`\nFAIL — ${breaching.length} finding(s) at or above "${opts.failOn}".`);
      process.exit(1);
    }
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(`DOM-Surgeon crashed: ${err?.stack || err}`);
  process.exit(2);
});
