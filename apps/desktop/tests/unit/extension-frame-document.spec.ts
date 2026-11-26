import vm from "node:vm";
import type { DesktopViewContext } from "@pi-gui/extension-ui/browser";
import { expect, test } from "@playwright/test";
import { createJiti } from "jiti";
import { extensionFrameDocument } from "../../electron/extensions/extension-frame-document";

let parseDesktopHostAction: typeof import("@pi-gui/extension-ui/browser").parseDesktopHostAction;
test.beforeAll(async () => {
  ({ parseDesktopHostAction } = await createJiti(__filename).import<
    typeof import("@pi-gui/extension-ui/browser")
  >("@pi-gui/extension-ui/browser"));
});

test("a thread action's promise reaction runs before its frame acknowledges the result", async () => {
  const events: string[] = [];
  const sent: { type: string; requestId?: string }[] = [];
  let host!: DesktopViewContext;
  let connect!: (event: unknown) => Promise<void>;
  const parent = {};
  const port = {
    onmessage: undefined as ((event: { data: unknown }) => void) | undefined,
    start() {},
    postMessage(message: { type: string; requestId?: string }) {
      sent.push(structuredClone(message));
      events.push(message.type);
    },
  };
  const context = vm.createContext({
    parent,
    queueMicrotask,
    window: {
      addEventListener: (_name: string, callback: typeof connect) => {
        connect = callback;
      },
    },
    document: { getElementById: () => ({}), documentElement: { style: { setProperty() {} } } },
    parseDesktopHostAction: (input: unknown) => parseDesktopHostAction(structuredClone(input)),
    createChordClientConnection: () => ({ services: {}, signal: new AbortController().signal }),
    mount: (_root: unknown, value: DesktopViewContext) => {
      host = value;
      return () => {};
    },
  });
  const html = extensionFrameDocument({
    connectionId: "one",
    frontendUrl: "fixture:frontend",
    bridgeUrl: "fixture:bridge",
    nonce: "dummy",
  });
  const script = html
    .match(/<script type="module"[^>]*>([\s\S]*?)<\/script>/)![1]!
    .replace(/^import .+;$/gm, "");
  vm.runInContext(script, context);
  await connect({
    source: parent,
    data: { type: "pi-gui:extension-connect", connectionId: "one", theme: { mode: "light" } },
    ports: [port],
  });
  events.length = 0;
  const opened = host.actions.openThread("earlier").then(() => events.push("view saw thread open"));
  const requestId = sent.at(-1)!.requestId;
  port.onmessage!({ data: { type: "host-action-result", requestId, ok: true, acknowledge: true } });
  expect(events).toEqual(["host-action"]);
  await opened;
  expect(events).toEqual(["host-action", "view saw thread open", "host-action-ack"]);
  expect(sent.at(-1)).toEqual({ type: "host-action-ack", requestId });

  events.length = 0;
  const url = host.actions.openUrl("https://example.com");
  port.onmessage!({
    data: { type: "host-action-result", requestId: sent.at(-1)!.requestId, ok: true },
  });
  await url;
  expect(events).toEqual(["host-action"]);
});
