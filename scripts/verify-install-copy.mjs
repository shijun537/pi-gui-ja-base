import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

async function main() {
  const [readme, siteMetadata, websitePage, legalText] = await Promise.all([
    readFile(path.join(repoRoot, "README.md"), "utf8"),
    readFile(path.join(repoRoot, "apps", "website", "app", "site.ts"), "utf8"),
    readFile(path.join(repoRoot, "apps", "website", "app", "page.tsx"), "utf8"),
    readFile(path.join(repoRoot, "apps", "website", "app", "data", "legal.json"), "utf8"),
  ]);

  assert.match(readme, /^# pi-gui-ja-base — 日本語で使い、改造するための土台/m);
  assert.match(readme, /corepack pnpm install --frozen-lockfile/);
  assert.match(readme, /PI_APP_USER_DATA_DIR/);
  assert.match(readme, /PI_CODING_AGENT_DIR/);
  assert.match(readme, /## 試作・候補の状態と既知の問題/);
  assert.match(readme, /上流版の Releases と公式サイトは、上流版の案内/);
  assert.doesNotMatch(readme, /Download the latest|brew install --cask|brew upgrade --cask/);

  assert.match(siteMetadata, /SITE_NAME = "pi-gui-ja-base"/);
  assert.match(siteMetadata, /github\.com\/shijun537\/pi-gui-ja-base/);
  assert.match(websitePage, /現在は開発者向けのソース公開/);
  assert.match(
    websitePage.replace(/\s+/g, " "),
    /正式な Windows 配布版のダウンロードは案内していません/,
  );
  assert.match(websitePage, /実アプリのスクリーンショットではありません/);
  assert.doesNotMatch(websitePage, /DownloadButton|BREW_INSTALL|brew install --cask/);
  const legal = JSON.parse(legalText);
  assert.deepEqual(Object.keys(legal).sort(), ["licenses", "privacy", "status", "terms"]);
  assert.match(JSON.stringify(legal.terms), /追加の制限を課すものではありません/);
  assert.match(JSON.stringify(legal.privacy), /IP アドレス/);

  process.stdout.write(
    "Japanese fork README, landing page, and usage notices describe source installation and verification limits.\n",
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
