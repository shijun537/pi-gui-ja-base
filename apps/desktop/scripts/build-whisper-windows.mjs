import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const desktop = fileURLToPath(new URL("../", import.meta.url));
const sourceRoot = path.join(desktop, "build", "whisper-source");
const runtime = path.join(desktop, "build", "whisper");
const tag = "v1.9.5";
const sourceSha256 = "7a7a73071939f16bc028ad2f713f16f26e37afb6cc155d0f19e3d65705d2b1d9";

function run(command, args) {
  const child = spawnSync(command, args, { stdio: "inherit" });
  if (child.error) throw child.error;
  if (child.status !== 0) throw new Error(`${command} exited with status ${child.status}.`);
}

function cmakePath() {
  const programFiles = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
  const vswhere = path.join(programFiles, "Microsoft Visual Studio", "Installer", "vswhere.exe");
  const found = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.VisualStudio.Component.VC.CMake.Project",
      "-property",
      "installationPath",
    ],
    { encoding: "utf8" },
  ).stdout?.trim();
  return found
    ? path.join(
        found,
        "Common7",
        "IDE",
        "CommonExtensions",
        "Microsoft",
        "CMake",
        "CMake",
        "bin",
        "cmake.exe",
      )
    : "cmake.exe";
}

async function buildRuntime(cmake, source, vulkan) {
  const build = path.join(sourceRoot, vulkan ? "vulkan-build" : "cpu-build");
  run(cmake, [
    "-S",
    source,
    "-B",
    build,
    "-A",
    "x64",
    "-DCMAKE_POLICY_DEFAULT_CMP0091=NEW",
    "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DGGML_NATIVE=OFF",
    "-DGGML_OPENMP=OFF",
    `-DGGML_VULKAN=${vulkan ? "ON" : "OFF"}`,
    "-DWHISPER_BUILD_TESTS=OFF",
  ]);
  run(cmake, [
    "--build",
    build,
    "--config",
    "Release",
    "--target",
    "whisper-cli",
    "--parallel",
    vulkan ? "4" : "2",
    "--",
    "/nodeReuse:false",
  ]);
  await copyFile(
    path.join(build, "bin", "Release", "whisper-cli.exe"),
    path.join(runtime, vulkan ? "whisper-vulkan.exe" : "whisper-cli.exe"),
  );
}

export async function buildWhisperWindows() {
  if (process.platform !== "win32")
    throw new Error("The Whisper runtime must be built on Windows.");

  await mkdir(sourceRoot, { recursive: true });
  const archive = path.join(sourceRoot, `${tag}.zip`);
  let bytes = await readFile(archive).catch(() => undefined);
  if (!bytes) {
    const url = `https://codeload.github.com/ggml-org/whisper.cpp/zip/refs/tags/${tag}`;
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok)
      throw new Error(`Could not download Whisper source (HTTP ${response.status}).`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(bytes).digest("hex") !== sourceSha256) {
    throw new Error("Whisper source archive verification failed.");
  }
  await writeFile(archive, bytes);
  run("tar.exe", ["-xf", archive, "-C", sourceRoot]);

  const source = path.join(sourceRoot, `whisper.cpp-${tag.slice(1)}`);
  const cmake = cmakePath();
  await mkdir(runtime, { recursive: true });
  await buildRuntime(cmake, source, false);
  if (process.env.PI_APP_BUILD_WHISPER_VULKAN === "1") {
    await buildRuntime(cmake, source, true);
  } else {
    await rm(path.join(runtime, "whisper-vulkan.exe"), { force: true });
  }
  await copyFile(path.join(source, "LICENSE"), path.join(runtime, "LICENSE"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildWhisperWindows();
}
