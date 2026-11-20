import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exec } from "../src/lib/exec.js";
import { TOOLS } from "../src/lib/tools.js";
import { normalizeWaDownloadVideo, parseWaDownload } from "../src/lib/wa-download-video.js";
import { exceedsUploadLimit, MAX_UPLOAD_BYTES } from "../src/lib/media.js";
import { formatCommandHelp } from "../src/lib/command-help.js";

test("download flags are scoped to Facebook and Instagram", () => {
  for (const platform of ["fb", "ig"] as const) {
    assert.equal(parseWaDownload(`.${platform} https://example.test/v`, "", platform).resolution, 720);
    assert.equal(parseWaDownload(`.${platform} -HD https://example.test/v`, "", platform).resolution, 1080);
    assert.equal(parseWaDownload(`.${platform} -hd`, "https://example.test/v", platform).resolution, 1080);
  }
  assert.equal(parseWaDownload(".dl -hd https://instagram.com/reel/a", "", null).resolution, 1080);
  assert.equal(parseWaDownload(".dl", "https://fb.watch/a", null).resolution, 720);
  assert.equal(parseWaDownload(".x -hd https://x.com/a", "", "x").resolution, null);
  assert.equal(parseWaDownload(".dl https://x.com/a", "", null).resolution, null);
  assert.equal(parseWaDownload(".fb https://fb.watch/a?x=-hd", "", "fb").resolution, 720);
  for (const command of ["fb", "ig", "dl"]) {
    assert.match(formatCommandHelp(command, "whatsapp", "!"), /720p.*1080p.*-hd/);
    assert.ok(formatCommandHelp(command, "whatsapp", "!").includes(`!${command} -hd`));
    assert.doesNotMatch(formatCommandHelp(command, "telegram"), /-hd/);
  }
});

test("normalizes actual videos, remuxes compatible streams and rejects failed processes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-video-test-"));
  try {
    const path = join(dir, "source.mp4");
    const created = await exec(TOOLS.ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=size=1920x1080:rate=60", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "0.2", "-c:v", "mpeg4", "-c:a", "aac", path]);
    assert.equal(created.code, 0, created.stderr);
    const file = { path, name: "source.mp4", kind: "video" as const, size: (await stat(path)).size };
    for (const resolution of [720, 1080]) {
      const result = await normalizeWaDownloadVideo(file, dir, resolution);
      const probe = await exec(TOOLS.ffprobe, ["-v", "error", "-show_streams", "-of", "json", result.path]);
      const streams = JSON.parse(probe.stdout).streams;
      const video = streams.find((s: any) => s.codec_type === "video");
      assert.equal(video.height, resolution);
      assert.equal(video.codec_name, "h264");
      assert.equal(video.pix_fmt, "yuv420p");
      assert.equal(streams.find((s: any) => s.codec_type === "audio").codec_name, "aac");
      const bytes = await readFile(result.path);
      assert.ok(bytes.indexOf("moov") < bytes.indexOf("mdat"));
      let copied = false;
      await normalizeWaDownloadVideo(result, dir, resolution, async (cmd, args, options) => {
        if (cmd === TOOLS.ffmpeg) copied = args[args.indexOf("-c:v") + 1] === "copy";
        return exec(cmd, args, options);
      });
      assert.equal(copied, true);
    }
    const silent = join(dir, "silent.mp4");
    assert.equal((await exec(TOOLS.ffmpeg, ["-y", "-v", "error", "-f", "lavfi", "-i", "color=size=240x320:rate=24", "-t", "0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p", silent])).code, 0);
    const small = await normalizeWaDownloadVideo({ ...file, path: silent }, dir, 720);
    const smallProbe = await exec(TOOLS.ffprobe, ["-v", "error", "-show_streams", "-of", "json", small.path]);
    assert.equal(JSON.parse(smallProbe.stdout).streams[0].width, 240);
    assert.equal(JSON.parse(smallProbe.stdout).streams.length, 1);
    await assert.rejects(normalizeWaDownloadVideo(file, dir, 720, async () => ({ code: 1, stdout: "", stderr: "failed" })), /diperiksa/);
    await assert.rejects(normalizeWaDownloadVideo(file, dir, 720, async (cmd, args, opts) => cmd === TOOLS.ffmpeg ? { code: 1, stdout: "", stderr: "failed" } : exec(cmd, args, opts)), /Konversi/);
    await assert.rejects(normalizeWaDownloadVideo(file, dir, 720, async (cmd, args, opts) => {
      if (cmd === TOOLS.ffprobe && args.at(-1) !== path) {
        return { code: 0, stdout: JSON.stringify({ streams: [] }), stderr: "" };
      }
      return exec(cmd, args, opts);
    }), /tidak sesuai/);
    assert.equal(exceedsUploadLimit(MAX_UPLOAD_BYTES + 1), true);
    assert.equal(exceedsUploadLimit(small.size), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
