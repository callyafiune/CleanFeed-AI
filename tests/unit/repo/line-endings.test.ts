// Guards the repository's end-of-line contract and the rest of the byte-level
// hygiene of a tracked path, which are tooling invariants and not style
// preferences.
//
// `core.autocrlf=true` (the Git for Windows default) checks text files out as
// CRLF while the blob stays LF. When a tool then rewrites such a file in LF, the
// index's cached stat size no longer matches the file on disk, and git's
// `ie_modified` fast path returns DATA_CHANGED without ever comparing content:
// `git status` reports the path as modified while `git diff` and
// `git diff --cached` are both empty and `git hash-object` equals the index blob.
// A `.gitattributes` that pins `eol=lf` makes the checkout itself LF, so the
// cached size matches what tools write and the phantom mark cannot appear.
//
// Pinning the attribute is not enough on its own: it governs the NEXT checkout
// and does not rewrite what is already on disk, so a file extracted as CRLF
// before the attribute existed keeps ghosting until it is written out again.
// That residual is asserted here too.
//
// The tests below read the real repository through git, not a fixture: the
// invariant is about what git resolves for tracked paths, so a fixture would
// assert nothing. Nothing here hardcodes a file count or an extension list —
// both are derived from `git ls-files` so the guard survives new files.
//
// Trap when editing these tests: git resolves attributes from the index when
// `.gitattributes` is missing from the working tree, so deleting the file does
// NOT turn the attribute assertions red. Presence on disk is asserted
// separately for that reason.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();

function git(args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

interface EolEntry {
  readonly indexEol: string;
  readonly worktreeEol: string;
  readonly attr: string;
  readonly path: string;
}

/**
 * `git ls-files --eol` reports, per tracked path, the line ending git sees in the
 * index (`i/`), the one in the working tree (`w/`) and the resolved attributes.
 * `i/-text` means git's own binary heuristic classified the blob as binary, so no
 * conversion is applied to it whatever the attributes say; `i/none` is an empty
 * file. Output columns are whitespace-padded and the path follows a tab.
 */
function listEol(): readonly EolEntry[] {
  return git(["ls-files", "--eol", "-z"])
    .split("\0")
    .filter((line) => line.length > 0)
    .map((line) => {
      const tab = line.indexOf("\t");
      // The `attr/` column itself contains spaces ("attr/text=auto eol=lf"), so
      // only the first two columns may be split on whitespace.
      const columns = /^(\S+)\s+(\S+)\s+(.*)$/u.exec(line.slice(0, tab).trim());
      return {
        indexEol: columns?.[1] ?? "",
        worktreeEol: columns?.[2] ?? "",
        attr: columns?.[3]?.trim() ?? "",
        path: line.slice(tab + 1),
      };
    });
}

function checkAttr(
  attribute: string,
  path: string,
): { readonly value: string } {
  // `git check-attr` answers for a path whether or not it exists on disk, which
  // is what lets us probe an extension the repo does not track yet.
  const line = git(["check-attr", attribute, "--", path]).trim();
  return { value: line.slice(line.lastIndexOf(": ") + 2) };
}

const attributesFile = join(repoRoot, ".gitattributes");

/** Extensions the repository declares `binary`, read from `.gitattributes`. */
function declaredBinaryExtensions(): readonly string[] {
  const raw = readFileSync(attributesFile, "utf8");
  const extensions: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const [pattern, ...attributes] = trimmed.split(/\s+/u);
    if (!attributes.includes("binary")) continue;
    if (pattern !== undefined && pattern.startsWith("*.")) {
      extensions.push(pattern.slice(1).toLowerCase());
    }
  }
  return extensions;
}

function extensionOf(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  return dot > slash ? path.slice(dot).toLowerCase() : "";
}

/**
 * `line:column` for a byte offset, because `path:number` is read as a line number by
 * every editor and CI annotator, and a byte offset put there points nowhere. The
 * column counts BYTES, which equals characters only on an ASCII line, so the caller
 * keeps the exact offset in the message as well.
 */
function lineAndColumn(bytes: Buffer, offset: number): string {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (bytes[index] === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return `${line}:${offset - lineStart + 1}`;
}

/** Byte-exact CRLF -> LF rewrite, the transform a normalizing tool applies. */
function toLf(bytes: Buffer): Buffer {
  return Buffer.from(
    bytes.toString("latin1").replaceAll("\r\n", "\n"),
    "latin1",
  );
}

describe("repository end-of-line contract", () => {
  it("keeps .gitattributes present in the working tree", () => {
    // git falls back to the indexed blob when the file is absent from disk, so
    // the attribute assertions below stay green after a deletion. Only this one
    // catches it.
    expect(existsSync(attributesFile)).toBe(true);
  });

  it("resolves text=auto and eol=lf for every kind of tracked text file", () => {
    const entries = listEol();
    // One representative per extension among the files git itself treats as
    // text, derived from the repo so a newly introduced file type is covered.
    const representatives = new Map<string, string>();
    for (const entry of entries) {
      if (entry.indexEol === "i/-text") continue;
      const extension = extensionOf(entry.path);
      if (!representatives.has(extension)) {
        representatives.set(extension, entry.path);
      }
    }
    expect(representatives.size).toBeGreaterThan(5);

    const wrong = [...representatives.values()].filter((path) => {
      return (
        checkAttr("text", path).value !== "auto" ||
        checkAttr("eol", path).value !== "lf"
      );
    });
    expect(wrong).toEqual([]);
  });

  it("keeps every tracked text blob in LF in the index", () => {
    // The whole change is only safe because the blobs are ALREADY LF: pinning
    // eol=lf must be a no-op for content and change checkout behaviour only. A
    // blob that is CRLF or mixed would move under renormalization.
    const offenders = listEol()
      .filter(
        (entry) => entry.indexEol === "i/crlf" || entry.indexEol === "i/mixed",
      )
      .map((entry) => entry.path);
    expect(offenders).toEqual([]);
  });

  it("declares the attribute on every tracked text path, not just some", () => {
    const undeclared = listEol()
      .filter((entry) => entry.indexEol !== "i/-text")
      .filter((entry) => !entry.attr.includes("eol=lf"))
      .map((entry) => `${entry.path} (${entry.attr})`);
    expect(undeclared).toEqual([]);
  });

  it("never lets git convert a path declared binary", () => {
    const extensions = declaredBinaryExtensions();
    expect(extensions.length).toBeGreaterThan(0);
    // `binary` is the macro `-text -diff`, so `text` must resolve to unset. A
    // binary run through EOL conversion is file corruption, which is the only
    // way this contract can destroy data.
    const converted = extensions.filter(
      (extension) =>
        checkAttr("text", `probe-not-on-disk${extension}`).value !== "unset",
    );
    expect(converted).toEqual([]);
  });

  it("declares no extension binary that the repo tracks as text", () => {
    const binary = new Set(declaredBinaryExtensions());
    const misdeclared = listEol()
      .filter((entry) => entry.indexEol !== "i/-text")
      .map((entry) => extensionOf(entry.path))
      .filter((extension) => binary.has(extension));
    expect([...new Set(misdeclared)]).toEqual([]);
  });

  it("leaves no tracked path CRLF in the working tree", () => {
    // The attribute governs the next checkout; it does not rewrite what is
    // already on disk. Every path listed here still produces the phantom mark
    // when a tool normalizes it, and every one of them makes an on-disk digest
    // (computeEvaluatorDigest reads bytes from the working tree) depend on the
    // platform that checked the file out. To clear one: delete it,
    // `git checkout-index -f -- <path>`, then `git add <path>`. Plain
    // `git checkout-index -f` over an existing file is a no-op, because the
    // cached size still matches the CRLF bytes — the same fast path that
    // fabricates the phantom mark also blocks the repair.
    const stale = listEol()
      .filter((entry) => entry.worktreeEol === "w/crlf")
      .map((entry) => entry.path);
    expect(stale).toEqual([]);
  });

  it("does not mark a file modified when a tool normalizes it to LF", () => {
    // A path with real uncommitted edits is already reported modified, which
    // says nothing about line endings, so those are excluded — the suite has to
    // survive being run on a dirty tree.
    const dirty = new Set(
      git(["status", "--porcelain", "-z"])
        .split("\0")
        .filter((entry) => entry.length > 3)
        .map((entry) => entry.slice(3)),
    );
    const entries = listEol().filter((entry) => !dirty.has(entry.path));
    // Prefer a path that is CRLF on disk: that is the class the phantom mark
    // afflicts, so probing a w/lf path while a w/crlf one exists would prove
    // the invariant on the only files that never broke it.
    const target =
      entries.find((entry) => entry.worktreeEol === "w/crlf") ??
      entries.find(
        (entry) => entry.indexEol === "i/lf" && entry.worktreeEol === "w/lf",
      );
    expect(target).toBeDefined();
    const absolute = join(repoRoot, ...target!.path.split("/"));
    const original = readFileSync(absolute);
    try {
      writeFileSync(absolute, toLf(original));
      const status = git(["status", "--porcelain", "--", target!.path]);
      expect(status).toBe("");
    } finally {
      writeFileSync(absolute, original);
    }
  });
});

describe("repository control-byte contract", () => {
  it("leaves no raw control byte in a tracked path the repo calls text", () => {
    // An invisible byte changes what tools see without changing what review reads: a
    // NUL inside the first 8000 bytes makes git classify the blob as binary, so
    // `git diff` prints "Binary files differ" instead of the change, and ripgrep drops
    // the file from a recursive search altogether. Where such a code point IS the
    // value of something — the composite-key separators of `benchmark/bootstrap.ts`,
    // `benchmark/near-duplicates.ts` and `benchmark/split-audit.ts` — this repository
    // writes it as an escape, and this is what holds that to the whole tracked tree.
    //
    // The exemption is the DECLARED binary extensions, never git's own `i/-text`
    // classification: that classification is CAUSED by the raw byte, so filtering on
    // it would skip exactly the paths being looked for — which is what the `i/-text`
    // filter in the tests above did. And unlike the diff heuristic it has no window:
    // a NUL anywhere in the blob flips `i/`, whatever its offset. CR is excluded
    // because line endings are owned by the tests above.
    const binary = new Set(declaredBinaryExtensions());
    const paths = listEol()
      .map((entry) => entry.path)
      .filter((path) => !binary.has(extensionOf(path)));
    expect(paths.length).toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const path of paths) {
      const bytes = readFileSync(join(repoRoot, ...path.split("/")));
      for (const [offset, byte] of bytes.entries()) {
        const invisible =
          (byte < 0x20 && byte !== 0x0a && byte !== 0x09 && byte !== 0x0d) ||
          byte === 0x7f;
        if (!invisible) continue;
        offenders.push(
          `${path}:${lineAndColumn(bytes, offset)} carries 0x${byte
            .toString(16)
            .padStart(2, "0")} at byte offset ${offset}`,
        );
        break;
      }
    }
    expect(offenders).toEqual([]);
  });
});
