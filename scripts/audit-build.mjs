#!/usr/bin/env node
// Static security audit of a built, unpacked extension directory.
//
//   node scripts/audit-build.mjs <dist>
//
// Exit 0 when the build is clean; exit 1 (printing every reason) when it is not.
// The audit fails if the manifest widens the shipped allowlist of permissions,
// host permissions or the content security policy, if the manifest references a
// file that is not present, if a shipped source/map artifact leaked into the
// bundle, or if any bundled .js/.mjs/.html/.css contains a dangerous SYNTACTIC
// form: a remote import/fetch/`new URL`, a remote `@import`, an external
// source-map, an `eval` call, or a `new Function` construction.
//
// Detection is data-driven (arrays of RegExp) and matches FORMS, not any "http"
// substring, so a documentary URL in a string never trips it. The patterns are
// written from fragments on purpose, so this auditor never itself contains a
// literal eval-call or a literal remote import statement.

import console from "node:console";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { argv, exit } from "node:process";

/** The exact allowlists the shipped extension is locked to. */
const ALLOWED_PERMISSIONS = new Set([
  "storage",
  "contextMenus",
  "activeTab",
  "scripting",
  "offscreen",
]);
const ALLOWED_HOST_PERMISSIONS = new Set(["https://www.linkedin.com/*"]);
const LOCKED_CSP =
  "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'";

/**
 * Dist-relative path prefixes whose eval/new-Function forms are the vendored
 * ONNX Runtime (emscripten) WASM loader. They are third-party and, decisively,
 * INERT under the shipped CSP: `extension_pages` grants `'wasm-unsafe-eval'` but
 * NOT `'unsafe-eval'`, so the browser blocks any runtime eval or `new Function`.
 * Remote-network forms are still forbidden here — only eval/new-Function are
 * tolerated, and only inside these vendored files.
 */
const EVAL_EXEMPT_PREFIXES = [
  "vendor/transformers-wasm/",
  // The bundled ML runtime (Transformers.js + the emscripten ONNX WASM loader)
  // generates WASM bindings via the Function constructor; like the vendored
  // loader it is third-party and INERT under the shipped CSP (no 'unsafe-eval').
  // Named by crxjs's stable chunk prefix; the trailing hash varies per build.
  "assets/inference-worker-",
];

const TEXT_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".css",
]);

/** Source/map artifacts that must never appear in a shipped bundle. */
const FORBIDDEN_ARTIFACT = /\.(?:map|ts|tsx|jsx|scss|sass|less|vue)$/u;

// Fragments kept apart so this file never contains a literal dangerous form.
const REMOTE = String.raw`https?:\/\/`;
const QUOTE = "[`'\"]";

/** Network-reaching forms — always forbidden, everywhere in the bundle. */
const REMOTE_FORMS = [
  {
    id: "remote-import-bare",
    label: 'remote import (import "http…")',
    pattern: new RegExp(String.raw`\bimport\b\s*${QUOTE}${REMOTE}`, "u"),
  },
  {
    id: "remote-import-from",
    label: 'remote import (import … from "http…")',
    pattern: new RegExp(
      String.raw`\bimport\b[^;\n]*?\bfrom\b\s*${QUOTE}${REMOTE}`,
      "u",
    ),
  },
  {
    id: "remote-dynamic-import",
    label: 'dynamic import("http…")',
    pattern: new RegExp(String.raw`\bimport\b\s*\(\s*${QUOTE}${REMOTE}`, "u"),
  },
  {
    id: "remote-fetch",
    label: 'fetch("http…")',
    pattern: new RegExp(String.raw`\bfetch\s*\(\s*${QUOTE}${REMOTE}`, "u"),
  },
  {
    id: "remote-new-url",
    label: 'new URL("http…")',
    pattern: new RegExp(String.raw`\bnew\s+URL\s*\(\s*${QUOTE}${REMOTE}`, "u"),
  },
  {
    id: "remote-css-import",
    label: "remote @import url(http…)",
    pattern: new RegExp(
      String.raw`@import\s+(?:url\(\s*)?${QUOTE}?${REMOTE}`,
      "u",
    ),
  },
  {
    id: "external-sourcemap",
    label: "external sourceMappingURL",
    pattern: new RegExp(String.raw`sourceMappingURL\s*=\s*${REMOTE}`, "u"),
  },
];

/** Dynamic-code forms — forbidden except inside the vendored WASM loader. */
const EVAL_FORMS = [
  {
    id: "eval-call",
    label: "eval(...) call",
    pattern: /\beval\s*\(/u,
  },
  {
    id: "indirect-eval-comma",
    label: "indirect eval ((0,eval)(...))",
    pattern: /\(\s*0\s*,\s*eval\s*\)/u,
  },
  {
    id: "indirect-eval-bracket",
    label: 'bracket eval (["eval"])',
    pattern: new RegExp(String.raw`\[\s*${QUOTE}eval${QUOTE}\s*\]`, "u"),
  },
  {
    id: "function-constructor",
    // Catches both `new Function(` and a bare `Function(` constructor call, plus
    // an aliased reference invoked as a constructor is out of scope for a static
    // pass but the CSP (no 'unsafe-eval') blocks all of these at runtime anyway.
    label: "Function(...) constructor",
    pattern: /\bFunction\s*\(/u,
  },
];

function toPosix(path) {
  return path.split("\\").join("/");
}

/** Recursively lists every file under `directory` as absolute paths. */
function listFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else if (entry.isFile()) found.push(full);
  }
  return found;
}

/** Extracts a short, single-line snippet around the first match, for citing. */
function snippet(source, pattern) {
  const match = pattern.exec(source);
  if (match === null) return "";
  const start = Math.max(0, match.index - 12);
  return source
    .slice(start, match.index + match[0].length + 40)
    .replace(/\s+/gu, " ")
    .trim();
}

function auditManifest(distPath, reasons) {
  const manifestPath = join(distPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    reasons.push(`manifest.json is missing from ${distPath}`);
    return;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    reasons.push(`manifest.json is not valid JSON: ${String(error)}`);
    return;
  }

  for (const permission of manifest.permissions ?? []) {
    if (!ALLOWED_PERMISSIONS.has(permission)) {
      reasons.push(`permission not in allowlist: ${permission}`);
    }
  }

  for (const host of manifest.host_permissions ?? []) {
    if (!ALLOWED_HOST_PERMISSIONS.has(host)) {
      reasons.push(`host permission not in allowlist: ${host}`);
    }
  }

  // Optional permissions/hosts widen scope at runtime just like declared ones.
  for (const key of ["optional_permissions", "optional_host_permissions"]) {
    for (const value of manifest[key] ?? []) {
      reasons.push(`${key} not in allowlist: ${value}`);
    }
  }

  // A declarative content script is injected on every page matching its
  // `matches` REGARDLESS of host_permissions, so this DOM-reading script's match
  // scope must be locked just as tightly. Same for web-accessible-resource
  // exposure. Both are locked to the single shipped host.
  (manifest.content_scripts ?? []).forEach((entry, index) => {
    for (const match of entry.matches ?? []) {
      if (!ALLOWED_HOST_PERMISSIONS.has(match)) {
        reasons.push(
          `content_scripts[${index}].matches not in allowlist: ${match}`,
        );
      }
    }
  });
  (manifest.web_accessible_resources ?? []).forEach((entry, index) => {
    for (const match of entry.matches ?? []) {
      if (!ALLOWED_HOST_PERMISSIONS.has(match)) {
        reasons.push(
          `web_accessible_resources[${index}].matches not in allowlist: ${match}`,
        );
      }
    }
  });

  const csp = manifest.content_security_policy ?? {};
  if (csp.extension_pages !== LOCKED_CSP) {
    reasons.push(
      `content_security_policy.extension_pages does not match the locked CSP.\n` +
        `      expected: ${LOCKED_CSP}\n` +
        `      found:    ${csp.extension_pages ?? "(absent)"}`,
    );
  }
  for (const key of Object.keys(csp)) {
    if (key !== "extension_pages") {
      reasons.push(`unexpected content_security_policy key: ${key}`);
    }
  }

  const referenced = [
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
    ...(manifest.content_scripts ?? []).flatMap((entry) => [
      ...(entry.js ?? []),
      ...(entry.css ?? []),
    ]),
    ...(manifest.web_accessible_resources ?? []).flatMap(
      (entry) => entry.resources ?? [],
    ),
  ].filter((value) => typeof value === "string");

  for (const reference of referenced) {
    if (!existsSync(join(distPath, reference))) {
      reasons.push(`manifest references a missing file: ${reference}`);
    }
  }
}

function auditFiles(distPath, reasons) {
  for (const absolute of listFiles(distPath)) {
    const rel = toPosix(relative(distPath, absolute));
    const dot = rel.lastIndexOf(".");
    const extension = dot === -1 ? "" : rel.slice(dot).toLowerCase();

    if (FORBIDDEN_ARTIFACT.test(rel)) {
      reasons.push(`source/map artifact must not ship: ${rel}`);
      continue;
    }

    if (!TEXT_EXTENSIONS.has(extension)) continue;

    const source = readFileSync(absolute, "utf8");

    for (const form of REMOTE_FORMS) {
      if (form.pattern.test(source)) {
        reasons.push(
          `${rel}: forbidden ${form.label} (matched: ${snippet(source, form.pattern)})`,
        );
      }
    }

    const evalExempt = EVAL_EXEMPT_PREFIXES.some((prefix) =>
      rel.startsWith(prefix),
    );
    if (evalExempt) continue;

    for (const form of EVAL_FORMS) {
      if (form.pattern.test(source)) {
        reasons.push(
          `${rel}: forbidden ${form.label} (matched: ${snippet(source, form.pattern)})`,
        );
      }
    }
  }
}

function main() {
  const distPath = argv[2];
  if (distPath === undefined) {
    console.error("usage: node scripts/audit-build.mjs <dist>");
    exit(1);
  }
  if (!existsSync(distPath) || !statSync(distPath).isDirectory()) {
    console.error(`audit FAILED — not a directory: ${distPath}`);
    exit(1);
  }

  const reasons = [];
  auditManifest(distPath, reasons);
  auditFiles(distPath, reasons);

  if (reasons.length > 0) {
    console.error(
      `audit FAILED — ${reasons.length} problem(s) in ${distPath}:`,
    );
    for (const reason of reasons) console.error(`  - ${reason}`);
    exit(1);
  }

  console.log(`audit OK — ${distPath} matches the shipped security allowlist.`);
  exit(0);
}

main();
