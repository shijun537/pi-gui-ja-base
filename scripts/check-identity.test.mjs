import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { checkIdentity, UPSTREAM_EMAILS } from "./check-identity.mjs";

const roots = [];
after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
const email = (local, domain) => [local, domain].join("@");

function fixture(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pi-gui-identity-"));
  roots.push(root);
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
  return root;
}

function scan(files) {
  const root = fixture(files);
  return checkIdentity(root, { files: Object.keys(files) });
}

test("reports a real email address as unexpected", () => {
  const result = scan({
    "src/note.ts": `export const contact = "${email("someone", "real-domain.dev")}";`,
  });
  assert.equal(result.unexpected.length, 1);
  assert.match(result.unexpected[0].rule, /email/);
  assert.equal(result.unexpected[0].line, 1);
});

test("reports an absolute home directory naming a person", () => {
  const result = scan({
    "docs/run.md": `Run from ${["C:", "Users", "jane.doe", "project"].join("\\")}, or ${["", "home", "jane.doe", "work"].join("/")}.`,
  });
  assert.equal(result.unexpected.length, 2);
  assert.equal(result.unexpected[0].rule, "home directory path");
  assert.equal(result.unexpected[1].rule, "home directory path");
});

test("reports credentials wherever they appear", () => {
  const result = scan({
    "src/key.ts": `const key = "${["ghp_", "abcdefghijklmnopqrstuvwxyz0123456789"].join("")}";`,
    "src/aws.ts": `const id = "${["AKIA", "IOSFODNN7EXAMPLE"].join("")}";`,
    "src/pem.txt": ["-----BEGIN RSA", "PRIVATE KEY-----"].join(" "),
  });
  assert.equal(result.unexpected.length, 3);
});

test("accepts fixtures, platform accounts and package version specifiers", () => {
  const result = scan({
    "src/fixture.ts": `export const a = "${email("user", "example.com")}";`,
    "src/sub.ts": `export const b = "${email("agent", "ci.example.test")}";`,
    "docs/win.md": "Default profile lives at C:\\Users\\Administrator.",
    "pnpm-workspace.yaml": "  app-builder-lib@26.8.1: patches/app-builder-lib@26.8.1.patch",
  });
  assert.deepEqual(result.unexpected, []);
});

test("classifies the upstream author's contact details separately from local identity", () => {
  const result = scan({
    "apps/desktop/electron-builder.yml": `  maintainer: Upstream <${UPSTREAM_EMAILS[0]}>`,
  });
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.upstream.length, 1);
});

test("fails closed on binary files with a text extension", () => {
  const result = scan({ "assets/font.json": `abc\0${email("someone", "real-domain.dev")}` });
  assert.equal(result.unexpected[0].rule, "binary content in text candidate");
  assert.equal(result.scanned, 0);
});

test("ignores files outside the scanned extension set", () => {
  const result = scan({ "assets/font.woff2": email("someone", "real-domain.dev") });
  assert.deepEqual(result.unexpected, []);
  assert.equal(result.scanned, 0);
});

test("scans non-ignored untracked files before their first commit", () => {
  const root = fixture({
    "src/tracked.ts": "export const safe = true;",
    "src/new.ts": email("someone", "real-domain.dev"),
    ".gitignore": "ignored.txt\n",
    "ignored.txt": email("someone", "real-domain.dev"),
  });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "src/tracked.ts", ".gitignore"], { cwd: root });
  const result = checkIdentity(root);
  assert.equal(result.unexpected.length, 1);
  assert.equal(result.unexpected[0].file, "src/new.ts");
});

test("detects labeled Japanese identity, phone numbers, and internal hosts", () => {
  const result = scan({
    "docs/note.txt": `氏名${":"} 試験花子\n住所${":"} 架空県テスト市\n${["090", "0000", "0000"].join("-")}\n${["db01", "corp", "internal"].join(".")}`,
  });
  assert.deepEqual(result.unexpected.map((finding) => finding.rule).sort(), [
    "Japanese identity label",
    "Japanese identity label",
    "internal hostname",
    "phone number",
  ]);
});

test("detects URL credentials and a token split across lines", () => {
  const result = scan({
    "docs/note.txt": `${["https://svc:", "syntheticpass", "@intranet"].join("")}\n${"ghp_"}abcdefghij\nklmnopqrstuvwxyz0123456789`,
  });
  assert.deepEqual(result.unexpected.map((finding) => finding.rule).sort(), [
    "URL credential",
    "split GitHub token",
  ]);
});

test("detects environment values and does not trust generic account names", () => {
  const result = scan({
    ".env.local": "TOKEN=syntheticpass",
    "docs/note.txt": `/home/${"user"}/project\n${email("user", "corp.invalid")}`,
  });
  assert.deepEqual(result.unexpected.map((finding) => finding.rule).sort(), [
    "email address",
    "environment credential",
    "home directory path",
  ]);
});

test("fails closed when a candidate cannot be read", () => {
  const result = scan({ "docs/present.txt": "safe" });
  const missing = checkIdentity(roots.at(-1), { files: ["docs/missing.txt"] });
  assert.equal(result.unexpected.length, 0);
  assert.equal(missing.unexpected[0].rule, "unreadable file");
});

test("scans a directory link without reading files outside the repository", () => {
  const root = fixture({});
  const outside = fixture({ "outside.txt": email("someone", "real-domain.dev") });
  const windows = process.platform === "win32";
  symlinkSync(
    windows ? outside : path.relative(root, outside),
    path.join(root, "linked"),
    windows ? "junction" : "dir",
  );

  const link = checkIdentity(root, { files: ["linked"] });
  assert.equal(link.scanned, 1);

  const outsideFile = checkIdentity(root, { files: ["linked/outside.txt"] });
  assert.equal(outsideFile.scanned, 0);
  assert.deepEqual(
    outsideFile.unexpected.map(({ rule }) => rule),
    ["unreadable file"],
  );
});

test("classifies the upstream contact only in its packaging files", () => {
  const result = scan({
    "docs/note.txt": UPSTREAM_EMAILS[0],
    "apps/desktop/electron-builder.yml": UPSTREAM_EMAILS[0],
  });
  assert.equal(result.unexpected.length, 1);
  assert.equal(result.upstream.length, 1);
});
