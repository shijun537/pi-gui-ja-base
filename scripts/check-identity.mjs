/**
 * Local identity guard.
 *
 * The repository is shipped as a fork with the author's upstream history. It must
 * never contain the maintainer's own identity: real email addresses, absolute home
 * directories, user names, credentials, or machine-specific paths.
 *
 * Two kinds of findings are reported:
 *
 * - `unexpected`: an identity-shaped string that is not on the allowlist. These fail.
 * - `upstream`: the upstream author's own contact details. They are pinned by
 *   `verify-release-config.mjs` and the Linux packaging scripts, so they are
 *   reported as information only and never fail this guard.
 *
 * The guard reads tracked files and non-ignored untracked files so a local check
 * also covers changes before their first commit.
 */
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Identity-shaped strings that are intentional fixtures or upstream contact details. */
export const UPSTREAM_EMAILS = [["minghinmatthew.lam", "gmail.com"].join("@")];
const UPSTREAM_CONTACT_FILES = new Set([
  "apps/desktop/electron-builder.yml",
  "apps/desktop/scripts/verify-release-config.mjs",
  "apps/desktop/scripts/verify-linux-release.sh",
]);
const FIXTURE_HOME_FILES =
  /^(?:apps\/desktop\/tests\/|apps\/desktop\/scripts\/verify-|scripts\/check-identity\.test\.mjs$)/;
const FIXTURE_HOME_NAMES = /^(?:pi|dev|runner|demo|acme|teammate|agent|someone|me|user|you)$/;

export const ALLOWLIST = [
  // Documentation and test fixtures only: any address under a reserved example domain.
  /@(?:[A-Za-z0-9-]+\.)*(?:example\.(?:com|test|invalid|org)|localhost)$/,
  // Third-party package metadata, not a person.
  /^i@izs\.me$/,
  /^git@github\.com$/,
  // Platform default accounts that no real person owns.
  /^(Administrator|Public|Default|Default User|All Users)$/,
];

/**
 * Captures the account component only. Windows separators are consumed in full so
 * a Windows profile path yields only its account segment, and a trailing sentence
 * period is not part of the account name.
 */
const HOME_PATH_PATTERN = /(?:[A-Za-z]:[\\/]+Users[\\/]+|\/Users\/|\/home\/)([\p{L}\p{N}._-]+)/gu;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_CREDENTIAL_PATTERN = /https?:\/\/[^\s/?#:@]+:[^\s@/?#]+@/g;
const PHONE_PATTERN = /(?:\+81-|0)\d{1,4}-\d{1,4}-\d{3,4}\b/g;
const INTERNAL_HOST_PATTERN = /\b(?:[A-Za-z0-9-]+\.)+[A-Za-z0-9-]+\.(?:internal|corp|lan|local)\b/g;
const LABELED_JAPANESE_IDENTITY_PATTERN = /(?:氏名|住所)\s*[:：]\s*\S+/gu;

/** Credential shapes that must never be committed, wherever they appear. */
const SECRET_PATTERNS = [
  { name: "private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "Slack token", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
];
const SPLIT_GITHUB_TOKEN_PATTERN = /\bgh[pousr]_[A-Za-z0-9]{4,}(?:\r?\n[A-Za-z0-9]{4,}){1,2}/g;

/** Files whose contents are third-party data rather than project source. */
const SKIP_PATHS = [/^pnpm-lock\.yaml$/, /^LICENSE$/, /^\.git\//];

/** Extensions worth scanning; everything else is binary or generated. */
const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".jsonl",
  ".yml",
  ".yaml",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".sh",
  ".ps1",
  ".plist",
  ".toml",
  ".txt",
  ".svg",
  "",
]);

function isAllowed(value) {
  return ALLOWLIST.some((rule) => (rule instanceof RegExp ? rule.test(value) : rule === value));
}

function isAllowedHome(user, relative) {
  return isAllowed(user) || (FIXTURE_HOME_FILES.test(relative) && FIXTURE_HOME_NAMES.test(user));
}

function candidateFiles(root) {
  const output = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return [...new Set(output.split("\0").filter((entry) => entry.length > 0))];
}

/**
 * Scan one file's text for identity findings.
 * `relative` is repository-relative and uses forward slashes.
 */
export function scanFile(relative, text) {
  const findings = [];
  const lines = text.split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const urlCredentials = [...line.matchAll(URL_CREDENTIAL_PATTERN)];

    for (const secret of SECRET_PATTERNS) {
      if (secret.pattern.test(line)) {
        findings.push({
          kind: "unexpected",
          rule: secret.name,
          file: relative,
          line: lineNumber,
          detail: "credential-shaped string",
        });
      }
    }

    for (const [rule, pattern] of [
      ["phone number", PHONE_PATTERN],
      ["internal hostname", INTERNAL_HOST_PATTERN],
      ["Japanese identity label", LABELED_JAPANESE_IDENTITY_PATTERN],
    ]) {
      if (pattern.test(line)) {
        findings.push({
          kind: "unexpected",
          rule,
          file: relative,
          line: lineNumber,
          detail: "value redacted",
        });
      }
      pattern.lastIndex = 0;
    }

    for (const match of urlCredentials) {
      findings.push({
        kind: "unexpected",
        rule: "URL credential",
        file: relative,
        line: lineNumber,
        detail: "value redacted",
      });
    }

    if (
      /(?:^|\/)\.env(?:\.[^/]*)?$/.test(relative) &&
      /(?:TOKEN|SECRET|PASSWORD|API_KEY)\s*=\s*\S{8,}/i.test(line)
    ) {
      findings.push({
        kind: "unexpected",
        rule: "environment credential",
        file: relative,
        line: lineNumber,
        detail: "value redacted",
      });
    }

    for (const match of line.matchAll(EMAIL_PATTERN)) {
      if (
        urlCredentials.some(
          (url) => match.index >= url.index && match.index < url.index + url[0].length,
        )
      )
        continue;
      const address = match[0];
      if (UPSTREAM_EMAILS.includes(address) && UPSTREAM_CONTACT_FILES.has(relative)) {
        findings.push({
          kind: "upstream",
          rule: "email address",
          file: relative,
          line: lineNumber,
          detail: "upstream contact",
        });
        continue;
      }
      if (isAllowed(address) || isVersionSpecifier(address)) continue;
      findings.push({
        kind: "unexpected",
        rule: "email address",
        file: relative,
        line: lineNumber,
        detail: "address redacted",
      });
    }

    for (const match of line.matchAll(HOME_PATH_PATTERN)) {
      // A sentence-ending period is punctuation, not part of the account name.
      const user = (match[1] ?? "").replace(/\.+$/, "");
      if (isAllowedHome(user, relative)) continue;
      findings.push({
        kind: "unexpected",
        rule: "home directory path",
        file: relative,
        line: lineNumber,
        detail: "account redacted",
      });
    }
  });

  for (const match of text.matchAll(SPLIT_GITHUB_TOKEN_PATTERN)) {
    const compact = match[0].replace(/\r?\n/g, "");
    if (compact.length < 25) continue;
    const line = text.slice(0, match.index).split(/\r?\n/).length;
    findings.push({
      kind: "unexpected",
      rule: "split GitHub token",
      file: relative,
      line,
      detail: "credential-shaped string",
    });
  }

  return findings;
}

/**
 * A package version spec such as `pkg@1.2.3` or `@scope/pkg@1.2.3` matches the
 * email shape but is not an address: the domain part is a dotted version.
 */
function isVersionSpecifier(value) {
  return /@\d+(?:\.\d+)+\.(?:patch|diff)$/.test(value);
}

function readCandidate(root, relative) {
  const filename = path.resolve(root, relative);
  const parent = path.dirname(filename);
  const relativeParent = path.relative(root, parent);
  if (
    relativeParent === ".." ||
    relativeParent.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeParent) ||
    path.relative(parent, realpathSync(parent)) !== ""
  ) {
    throw new Error("candidate parent is outside its repository path");
  }

  const stat = lstatSync(filename);
  // Git stores the link text. Scan that text without following the link.
  if (stat.isSymbolicLink()) return readlinkSync(filename, { encoding: "buffer" });
  if (!stat.isFile()) throw new Error("candidate is not a regular file");
  return readFileSync(filename);
}

/**
 * Run the guard over a repository. Returns every finding, split by severity.
 * `files` may be narrowed for tests.
 */
export function checkIdentity(root = repoRoot, options = {}) {
  const realRoot = realpathSync(root);
  const files = (options.files ?? candidateFiles(root)).filter((relative) => {
    const normalized = relative.split(path.sep).join("/");
    if (SKIP_PATHS.some((pattern) => pattern.test(normalized))) return false;
    return (
      TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase()) ||
      /(?:^|\/)\.env(?:\.[^/]*)?$/.test(normalized)
    );
  });

  const findings = [];
  let scanned = 0;
  for (const relative of files) {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(readCandidate(realRoot, relative));
    } catch {
      findings.push({
        kind: "unexpected",
        rule: "unreadable file",
        file: relative.split(path.sep).join("/"),
        line: 0,
        detail: "could not read candidate",
      });
      continue;
    }
    // A text-shaped candidate with binary bytes is unscannable, not clean.
    if (text.includes("\0")) {
      findings.push({
        kind: "unexpected",
        rule: "binary content in text candidate",
        file: relative.split(path.sep).join("/"),
        line: 0,
        detail: "could not scan candidate",
      });
      continue;
    }
    scanned += 1;
    findings.push(...scanFile(relative.split(path.sep).join("/"), text));
  }

  return {
    scanned,
    unexpected: findings.filter((finding) => finding.kind === "unexpected"),
    upstream: findings.filter((finding) => finding.kind === "upstream"),
  };
}

function format(finding) {
  return `${finding.file}:${finding.line}: ${finding.rule} — ${finding.detail}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = checkIdentity();
  if (result.upstream.length > 0) {
    console.log(
      `identity guard: ${result.upstream.length} upstream contact reference(s) are expected ` +
        "while the fork tracks upstream packaging metadata.",
    );
  }
  if (result.unexpected.length > 0) {
    console.error(
      `identity guard: ${result.unexpected.length} local identity finding(s) in ` +
        `${result.scanned} scanned files.`,
    );
    for (const finding of result.unexpected) console.error(`  ${format(finding)}`);
    console.error(
      "\nRemove the value, or add a narrow allowlist entry in scripts/check-identity.mjs " +
        "when it is an intentional fixture.",
    );
    process.exitCode = 1;
  } else {
    console.log(`identity guard: clean (${result.scanned} files scanned).`);
  }
}
