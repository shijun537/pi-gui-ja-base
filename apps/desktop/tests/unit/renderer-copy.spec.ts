import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "@playwright/test";

// Product and format names, plus executable examples, stay the same across locales.
const technicalCopy = new Set([
  "pi-gui",
  "URL",
  "API",
  "OAuth",
  "docs",
  "npx",
  "ollama-local",
  "model-id",
  "http://localhost:11434/v1",
  "http://localhost:8000/v1",
  "https://example.com/mcp",
  "-y @modelcontextprotocol/server-filesystem .",
  "--api-key",
  "/v1",
  "~/.pi/agent/models.json",
  "/bin/zsh",
]);
const attributes = new Set([
  "title",
  "description",
  "label",
  "aria-label",
  "placeholder",
  "textareaPlaceholder",
  "textareaLabel",
  "body",
  "backLabel",
]);
const sourceRoot = resolve(__dirname, "../../src");
/**
 * Surfaces that are fully translated. A directory entry covers every `.tsx` file in
 * it, so a new Settings section is checked without anyone adding it here.
 */
const translatedSurfaces = [
  "features/settings",
  "features/conversation/composer-panel.tsx",
  "features/conversation/composer-surface.tsx",
  "features/conversation/context-meter.tsx",
  "features/conversation/conversation-timeline.tsx",
  "features/conversation/fork-modal.tsx",
  "features/conversation/project-handoff-dialog.tsx",
  "features/conversation/image-attachment-thumb.tsx",
  "features/conversation/model-selector.tsx",
  "features/conversation/queued-composer-messages.tsx",
  "features/conversation/thread-search.tsx",
  "features/conversation/timeline-item.tsx",
  "features/threads/chat-header-actions.tsx",
  "features/workbench/diff-panel.tsx",
  "features/workbench/file-editor-pane.tsx",
  "features/workbench/file-explorer.tsx",
  "features/workbench/review-file-tree.tsx",
  "features/workbench/review-menu.tsx",
  "features/workbench/terminal-panel.tsx",
  "features/workbench/workbench-resize-handle.tsx",
  "features/workbench/workbench.tsx",
  "features/threads/new-thread-view.tsx",
  "features/scheduled-tasks",
  "features/extensions/customize-page.tsx",
  "features/extensions/skills-view.tsx",
  "features/extensions/extensions-view.tsx",
  "features/extensions/resource-list.tsx",
  "features/extensions/resource-detail.tsx",
  "app/topbar.tsx",
  "features/threads/sidebar.tsx",
  "features/threads/sidebar-toggle-button.tsx",
  "app/desktop-recovery.tsx",
  "app/secondary-surface.tsx",
  "app/secondary-surfaces.tsx",
];

async function surfaceFiles(): Promise<readonly string[]> {
  const files: string[] = [];
  for (const surface of translatedSurfaces) {
    if (surface.endsWith(".tsx")) {
      files.push(surface);
      continue;
    }
    const entries = await readdir(resolve(sourceRoot, surface));
    files.push(
      ...entries.filter((name) => name.endsWith(".tsx")).map((name) => `${surface}/${name}`),
    );
  }
  return files;
}

test("translated surfaces cannot bypass the locale catalogs", async () => {
  const files = await surfaceFiles();
  expect(files).toContain("features/settings/settings-view.tsx");
  const untranslated: string[] = [];
  for (const file of files) {
    const source = await readFile(resolve(sourceRoot, file), "utf8");
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const check = (node: ts.Node, text: string) => {
      const copy = text.replace(/\s+/g, " ").trim();
      if (!/[A-Za-z]{2}/.test(copy) || technicalCopy.has(copy)) return;
      untranslated.push(
        `${file}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${copy}`,
      );
    };
    const expression = (node: ts.Expression) => {
      if (ts.isStringLiteralLike(node)) check(node, node.text);
      else if (ts.isTemplateExpression(node))
        check(node, node.head.text + node.templateSpans.map((span) => span.literal.text).join(" "));
      else if (ts.isConditionalExpression(node)) {
        expression(node.whenTrue);
        expression(node.whenFalse);
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      )
        expression(node.right);
    };
    const walk = (node: ts.Node) => {
      if (ts.isJsxText(node)) check(node, node.text);
      if (ts.isJsxAttribute(node) && attributes.has(node.name.getText(tree)) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) check(node.initializer, node.initializer.text);
        else if (ts.isJsxExpression(node.initializer) && node.initializer.expression)
          expression(node.initializer.expression);
      }
      ts.forEachChild(node, walk);
    };
    walk(tree);
  }
  expect(
    untranslated,
    "User-facing strings must use the catalogs; add technical examples to the explicit allowlist",
  ).toEqual([]);
});
