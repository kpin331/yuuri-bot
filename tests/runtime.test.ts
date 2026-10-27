import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  configureRuntime,
  flushRuntimeLogs,
  logRuntimeEnvironment,
  parseRuntimeArgs,
  runtimeOptions,
  saveMediaFile,
  writeLog,
} from "../src/lib/runtime.js";
import { exec } from "../src/lib/exec.js";

const original = runtimeOptions();
const originalCwd = process.cwd();
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};
const originalFetch = globalThis.fetch;

afterEach(() => {
  configureRuntime(original);
  process.chdir(originalCwd);
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  globalThis.fetch = originalFetch;
});

describe("runtime options", () => {
  it("uses the current directory Media folder by default", () => {
    assert.deepEqual(parseRuntimeArgs([], "C:\\bot"), {
      saveMedia: false,
      mediaDirectory: join("C:\\bot", "Media"),
      log: false,
    });
  });

  it("parses save, drive and log options", () => {
    assert.deepEqual(parseRuntimeArgs(["-S", "E:", "--log"], "C:\\bot"), {
      saveMedia: true,
      mediaDirectory: "E:\\Media",
      log: true,
    });
    assert.equal(parseRuntimeArgs(["-S", "--log"], "C:\\bot").mediaDirectory, join("C:\\bot", "Media"));
  });

  it("rejects unsupported options", () => {
    assert.throws(() => parseRuntimeArgs(["--unknown"]), /Argumen tidak dikenal/);
  });

  it("creates the media directory and preserves an extension", async () => {
    const root = await mkdtemp(join(tmpdir(), "yuuri-runtime-"));
    try {
      const input = join(root, "source.jpg");
      const mediaDirectory = join(root, "Media");
      await writeFile(input, Buffer.from("image"));
      configureRuntime({ saveMedia: true, mediaDirectory, log: false });
      await saveMediaFile(input);

      const saved = await readdir(mediaDirectory);
      assert.equal(saved.length, 1);
      assert.match(saved[0] ?? "", /^source-[0-9a-f-]+\.jpg$/i);
      assert.equal((await readFile(join(mediaDirectory, saved[0]!))).toString(), "image");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes timestamped logs and redacts credentials", async () => {
    const root = await mkdtemp(join(tmpdir(), "yuuri-log-"));
    try {
      process.chdir(root);
      configureRuntime({ saveMedia: false, mediaDirectory: join(root, "Media"), log: true });
      writeLog("TEST", "token /bot123:secret Bearer hidden");
      await flushRuntimeLogs();

      const content = await readFile(join(root, "bot.log"), "utf8");
      assert.match(content, /^\d{4}-\d{2}-\d{2}T[\s\S]*\[TEST\]/);
      assert.doesNotMatch(content, /secret|hidden/);
      assert.match(content, /\[redacted\]/);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("logs safe fetch DNS, traffic headers, backend processes, and tool inventory", async () => {
    const root = await mkdtemp(join(tmpdir(), "yuuri-telemetry-"));
    try {
      process.chdir(root);
      globalThis.fetch = (async () => new Response("data", { headers: { "content-length": "4" } })) as typeof fetch;
      configureRuntime({ saveMedia: false, mediaDirectory: join(root, "Media"), log: true });
      await fetch("http://localhost/resource?private=value", { method: "POST", body: "hello" });
      logRuntimeEnvironment({ ffmpeg: true, ytDlp: false });
      await exec(process.execPath, ["-e", "process.stdout.write('ok')"]);
      await flushRuntimeLogs();

      const content = await readFile(join(root, "bot.log"), "utf8");
      assert.match(content, /\[FETCH\].*host=localhost.*dns_ips=.*status=200.*request_bytes=5 response_content_length=4/);
      assert.match(content, /\[BACKEND\].*sender_ip=not_exposed_by_platform.*ffmpeg:available.*ytDlp:missing/);
      assert.match(content, /\[PROCESS\].*program=node\.exe.*event=exit_code=0.*stdout_bytes=2/);
      assert.doesNotMatch(content, /private=value/);
    } finally {
      process.chdir(originalCwd);
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stops child processes that exceed the captured output limit", async () => {
    await assert.rejects(
      exec(process.execPath, ["-e", "process.stdout.write('x'.repeat(4096))"], { maxOutputBytes: 1024 }),
      /Keluaran perintah melebihi batas 1024 byte/,
    );
  });
});
