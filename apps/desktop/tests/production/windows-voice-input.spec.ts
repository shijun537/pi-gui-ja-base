import { copyFile, link, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { voiceModelBytes } from "../../contracts/voice-input";
import {
  launchDesktop,
  launchDesktopByExecutable,
  makeUserDataDir,
  seedAgentDir,
  setDesktopTestLocale,
} from "../helpers/electron-app";
import {
  startScriptedOpenAiServer,
  type ScriptedChatRequest,
} from "../helpers/scripted-openai-server";

const recording = process.env.PI_APP_TEST_VOICE_WAV;
const cachedModel = process.env.PI_APP_TEST_VOICE_MODEL;
const useJapanese = process.env.PI_APP_TEST_VOICE_LANGUAGE === "ja";
const voiceRuns = process.env.PI_APP_TEST_VOICE_REPEAT === "1" ? 2 : 1;

async function installCachedModel(source: string, target: string): Promise<void> {
  const model = resolve(source);
  await link(model, target).catch(() => copyFile(model, target));
}

async function selectJapanese(window: Page): Promise<void> {
  const settings = window.getByTestId("settings-surface");
  await window
    .locator("#primary-sidebar")
    .getByRole("button", { name: "設定", exact: true })
    .click();
  await settings.getByRole("button", { name: "一般", exact: true }).click();
  const language = settings.getByRole("combobox", { name: "文字起こしの言語" });
  await expect(language).toHaveValue("auto");
  await language.selectOption("ja");
  await expect(language).toHaveValue("ja");
  await settings.getByRole("button", { name: "アプリに戻る" }).click();
}

async function goOffline(
  harness: Awaited<ReturnType<typeof launchDesktopByExecutable>>,
  window: Page,
): Promise<void> {
  await harness.electronApp.evaluate(({ session }) => {
    session.defaultSession.enableNetworkEmulation({ offline: true });
    globalThis.fetch = () => Promise.reject(new Error("Network disabled for this smoke test."));
  });
  await window.context().setOffline(true);
}

async function watchVoiceLatency(draft: Locator): Promise<void> {
  await draft.evaluate((element: HTMLTextAreaElement) => {
    delete element.dataset.voiceLatencyMs;
    const observeStop = () => {
      document.removeEventListener("click", observeClick, true);
      const original = element.value;
      const started = performance.now();
      const update = () => {
        const elapsed = performance.now() - started;
        if (element.value !== original) element.dataset.voiceLatencyMs = String(elapsed);
        else if (element.isConnected && elapsed < 90_000) setTimeout(update, 16);
      };
      update();
    };
    const observeClick = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("button")?.getAttribute("aria-label") === "録音を停止"
      ) {
        observeStop();
      }
    };
    document.addEventListener("click", observeClick, true);
  });
}

async function attachVoiceLatency(draft: Locator, run: number): Promise<void> {
  await expect(draft).toHaveAttribute("data-voice-latency-ms", /^\d/);
  const latencyMs = Number(await draft.getAttribute("data-voice-latency-ms"));
  await test.info().attach(`voice-stop-to-draft-ms-${run}`, {
    body: String(latencyMs),
    contentType: "text/plain",
  });
}

test("sets up Windows voice input and appends local transcription to an editable draft", async () => {
  test.skip(process.platform !== "win32" || !recording, "Requires Windows and a synthetic WAV.");
  if (!recording) return;
  test.setTimeout(cachedModel ? 60_000 + voiceRuns * 90_000 : 600_000);
  const userData = await makeUserDataDir("pi-gui-voice-test-");
  const modelDirectory = join(userData, "voice-input");
  const modelPath = join(modelDirectory, "ggml-large-v3.bin");
  await mkdir(modelDirectory, { recursive: true });
  const releaseDir = process.env.PI_APP_TEST_RELEASE_DIR;
  const launchOptions = {
    fakeAudioCapturePath: resolve(recording),
    testMode: "background" as const,
    scrubProviderEnv: true,
  };
  const harness = releaseDir
    ? await launchDesktopByExecutable(
        resolve(releaseDir, "win-unpacked", "pi-gui.exe"),
        userData,
        launchOptions,
      )
    : await launchDesktop(userData, launchOptions);
  try {
    const window = await harness.firstWindow();
    await setDesktopTestLocale(window, "ja");
    if (useJapanese) await selectJapanese(window);
    await window.getByRole("button", { name: "チャット", exact: true }).click();
    const draft = window.getByTestId("new-thread-composer");
    const mic = window.getByRole("button", { name: "音声入力を開始" });
    const stop = window.getByRole("button", { name: "録音を停止" });
    await draft.fill("下書き");
    await mic.click();
    const download = window.getByRole("button", { name: "モデルをダウンロード" });
    await expect(download).toBeVisible();
    await expect(window.getByText(/約3.1 GB/)).toBeVisible();

    if (cachedModel) {
      await window.getByRole("button", { name: "キャンセル", exact: true }).click();
      await installCachedModel(cachedModel, modelPath);
    } else {
      await download.click();
      await expect(window.getByText(/モデルの準備ができました/)).toBeVisible({ timeout: 480_000 });
      expect((await stat(modelPath)).size).toBe(voiceModelBytes);
    }

    await goOffline(harness, window);
    await mic.click();
    await expect(stop).toBeVisible({ timeout: 30_000 });
    await window.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(draft).toHaveValue("下書き");

    for (let run = 1; run <= voiceRuns; run++) {
      await mic.click();
      await expect(stop).toBeVisible({ timeout: 30_000 });
      await draft.fill("更新した下書き");
      // Let the synthetic recording reach the sentence rather than stopping at the first frame.
      await expect(window.getByText(/録音中/)).toBeVisible();
      await new Promise((resolve) => setTimeout(resolve, 7_200));
      await watchVoiceLatency(draft);
      await stop.click();
      await expect(draft).toHaveValue(/^更新した下書き .*明日の朝.*会議/, { timeout: 90_000 });
      await attachVoiceLatency(draft, run);
    }
    await expect(window.getByTestId("transcript")).toHaveCount(0);

    const cameraDenied = await window.evaluate(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        stream.getTracks().forEach((track) => track.stop());
        return false;
      } catch (error) {
        return error instanceof DOMException && error.name === "NotAllowedError";
      }
    });
    expect(cameraDenied).toBe(true);

    await harness.electronApp.evaluate(({ session }) => {
      session.defaultSession.setPermissionCheckHandler(
        (_contents, permission) => permission !== "media",
      );
      session.defaultSession.setPermissionRequestHandler((_contents, permission, respond) => {
        respond(permission !== "media");
      });
    });
    await mic.click();
    await expect(window.getByText(/マイクの使用が許可されていません/)).toBeVisible();
  } finally {
    await harness.close();
    await rm(modelPath, { force: true });
  }
});

const voiceTestReply = "テスト先で受信しました。";

async function withVoiceTestModel(
  testMode: "foreground" | "background",
  fakeAudioCapturePath: string | undefined,
  exercise: (window: Page, received: ReadonlyMap<ScriptedChatRequest, number>) => Promise<void>,
): Promise<void> {
  const releaseDir = process.env.PI_APP_TEST_RELEASE_DIR;
  if (!releaseDir || !cachedModel) {
    throw new Error("The voice send test requires a Windows release and a cached voice model.");
  }
  const userData = await makeUserDataDir("pi-gui-voice-send-");
  const agentDir = join(userData, "agent");
  const modelDirectory = join(userData, "voice-input");
  const modelPath = join(modelDirectory, "ggml-large-v3.bin");
  await mkdir(modelDirectory, { recursive: true });
  await installCachedModel(cachedModel, modelPath);
  const received = new Map<ScriptedChatRequest, number>();
  const server = await startScriptedOpenAiServer((request) => {
    received.set(request, Date.now());
    return { text: voiceTestReply };
  });
  try {
    await seedAgentDir(agentDir, { withOpenAiAuth: false, withDefaultModel: false });
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultProvider: "scripted-test", defaultModel: "scripted" }),
    );
    await writeFile(
      join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          "scripted-test": {
            baseUrl: server.baseUrl,
            api: "openai-completions",
            apiKey: "unused",
            models: [{ id: "scripted" }],
          },
        },
      }),
    );
    const harness = await launchDesktopByExecutable(
      resolve(releaseDir, "win-unpacked", "pi-gui.exe"),
      userData,
      {
        agentDir,
        fakeAudioCapturePath,
        scrubProviderEnv: true,
        testMode,
      },
    );
    try {
      const window = await harness.firstWindow();
      await setDesktopTestLocale(window, "ja");
      await selectJapanese(window);
      await window.getByRole("button", { name: "チャット", exact: true }).click();
      await exercise(window, received);
    } finally {
      await harness.close();
    }
  } finally {
    await server.close();
    await rm(modelPath, { force: true });
  }
}

test("measures stop-to-send transcription from the real Windows microphone", async () => {
  test.skip(
    process.platform !== "win32" || process.env.PI_APP_TEST_VOICE_REAL_MIC !== "1",
    "Requires an operator to read the Japanese test sentence into the real microphone.",
  );
  test.setTimeout(300_000);
  await withVoiceTestModel("foreground", undefined, async (window, received) => {
    await window.getByTestId("new-thread-composer").fill("下書き確認。");
    await window.evaluate(() => {
      const observeStop = (event: KeyboardEvent) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.isComposing &&
          document.querySelector('button[aria-label="録音を停止"]')
        ) {
          performance.mark("voice-test-stop");
          document.removeEventListener("keydown", observeStop, true);
        }
      };
      document.addEventListener("keydown", observeStop, true);
    });
    await window.bringToFront();
    console.log(
      "マイク試験の準備完了。『午後二時三十五分に、ポート番号を八千八十から八千八十一に変更します。』",
    );
    const matchingRequest = () =>
      [...received].find(([request]) => {
        const last = request.messages.at(-1);
        return last?.role === "user" && last.content.includes("ポート番号");
      });
    await expect.poll(matchingRequest, { timeout: 240_000 }).toBeDefined();
    const match = matchingRequest();
    if (!match) throw new Error("The local voice test did not receive the spoken sentence.");
    const [request, receivedAt] = match;
    const stoppedAt = await window.evaluate(() => {
      const mark = performance.getEntriesByName("voice-test-stop", "mark")[0];
      return mark ? performance.timeOrigin + mark.startTime : null;
    });
    expect(stoppedAt).not.toBeNull();
    await test.info().attach("voice-stop-to-local-send-ms", {
      body: String(receivedAt - (stoppedAt ?? receivedAt)),
      contentType: "text/plain",
    });
    const text = request.messages.at(-1)?.content.normalize("NFKC") ?? "";
    expect({
      time: /(?:午後\s*2|14)時\s*35分/.test(text),
      oldPort: /\b8080\b/.test(text),
      newPort: /\b8081\b/.test(text),
    }).toEqual({ time: true, oldPort: true, newPort: true });
    await expect(window.getByTestId("transcript")).toContainText(voiceTestReply);
  });
});

test("sends the transcribed draft with one Enter in new and existing chats", async () => {
  test.skip(
    process.platform !== "win32" || process.env.PI_APP_TEST_VOICE_SEND !== "1",
    "Requires a synthetic Windows recording and a local scripted model.",
  );
  if (!recording) throw new Error("The voice send test requires a synthetic WAV.");
  test.setTimeout(240_000);
  await withVoiceTestModel("background", resolve(recording), async (window, received) => {
    const mic = window.getByRole("button", { name: "音声入力を開始" });
    const stop = window.getByRole("button", { name: "録音を停止" });
    for (const [id, prefix] of [
      ["new-thread-composer", "新しい会話の下書き"],
      ["composer", "続きの下書き"],
    ]) {
      const draft = window.getByTestId(id);
      await draft.fill(prefix);
      await mic.click();
      await expect(stop).toBeVisible({ timeout: 30_000 });
      await expect(draft).toBeFocused();
      await new Promise((resolve) => setTimeout(resolve, 7_200));
      await window.keyboard.press("Enter");
      await expect
        .poll(
          () =>
            [...received.keys()].filter((request) => {
              const last = request.messages.at(-1);
              return (
                last?.role === "user" &&
                last.content.startsWith(`${prefix} `) &&
                /明日の朝.*会議/.test(last.content)
              );
            }).length,
          { timeout: 90_000 },
        )
        .toBe(1);
      await expect(window.getByTestId("transcript")).toContainText(voiceTestReply);
    }
  });
});
