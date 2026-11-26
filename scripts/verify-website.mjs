import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(repo, "apps/website/out");
const prefix = "/pi-gui-ja-base/";
const routes = ["", "terms/", "privacy/", "licenses/", "status/"];
const pages = new Map();
for (const route of routes) {
  const html = await readFile(path.join(output, route, "index.html"), "utf8");
  assert.match(html, /<html[^>]*lang="ja"/, `${route}: Japanese document language`);
  assert.match(html, /<main[^>]*id="main"/, `${route}: skip-link target`);
  assert.doesNotMatch(html, /<form\b/i, `${route}: no data collection form`);
  pages.set(route, html);
}
let localReferences = 0;
for (const [route, html] of pages) {
  for (const match of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    const value = match[1].replaceAll("&amp;", "&");
    if (!value.startsWith("/") && !value.startsWith("#")) continue;
    const url = new URL(value, `https://example.test${prefix}${route}`);
    assert.ok(url.pathname.startsWith(prefix), `${route}: wrong deployment base path`);
    const relative = decodeURIComponent(url.pathname.slice(prefix.length));
    let filename = path.resolve(output, relative);
    assert.ok(!path.relative(output, filename).startsWith(".."), "reference escapes output");
    if ((await stat(filename)).isDirectory()) filename = path.join(filename, "index.html");
    await stat(filename);
    if (url.hash && filename.endsWith(".html")) {
      const target = await readFile(filename, "utf8");
      const id = decodeURIComponent(url.hash.slice(1));
      assert.ok(target.includes(`id="${id}"`), `${route}: missing anchor ${id}`);
    }
    localReferences++;
  }
  for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) {
    assert.ok(match[1].startsWith(prefix), "unexpected third-party script");
  }
}
const home = pages.get("");
assert.match(home, /正式な Windows 配布版のダウンロードは案内していません/);
assert.match(home, /実アプリのスクリーンショットではありません/);
assert.match(pages.get("licenses/"), /THE SOFTWARE IS PROVIDED/);
assert.match(pages.get("privacy/"), /IP アドレス/);
assert.match(pages.get("terms/"), /追加の制限を課すものではありません/);
const legal = JSON.parse(
  await readFile(path.join(repo, "apps/website/app/data/legal.json"), "utf8"),
);
for (const id of ["terms", "privacy", "licenses"]) {
  const markdown = await readFile(path.join(repo, "docs/legal", `${id}.md`), "utf8");
  for (const section of legal[id].sections) {
    for (const paragraph of section.paragraphs) {
      assert.ok(markdown.includes(paragraph), `${id}: website and Markdown notices differ`);
    }
  }
}
console.log(
  `Static website verified: ${pages.size} Japanese pages, ${localReferences} local references, matching legal notices.`,
);
