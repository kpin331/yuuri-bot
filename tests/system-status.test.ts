import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatSystemDiagnostics, splitStatusMessage, type SystemDiagnostics } from "../src/lib/system-status.js";

const snapshot: SystemDiagnostics = {
  processor: "Test CPU",
  logicalCores: 8,
  totalMemory: 16 * 1024 ** 3,
  freeMemory: 4 * 1024 ** 3,
  wifiSpeed: "866 Mbps",
  totalNodeMemory: 2 * 1024 ** 3,
  nodeMemory: {
    rss: 1024 ** 3,
    heapTotal: 512 * 1024 ** 2,
    heapUsed: 128 * 1024 ** 2,
    external: 0,
    arrayBuffers: 0,
  },
};

describe("system status text", () => {
  it("puts response time first and includes the requested host metrics", () => {
    const output = formatSystemDiagnostics(42, snapshot);
    assert.match(output, /^Waktu respons: 42 ms/);
    assert.match(output, /Prosesor: Test CPU/);
    assert.match(output, /RAM: 12\.00 GB dipakai/);
    assert.match(output, /Wi-Fi speed: 866 Mbps/);
    assert.match(output, /Node\.js memakai memori: total RSS 2\.00 GB/);
    assert.doesNotMatch(output, /Task manager|PID \| proses/);
  });

  it("splits long status messages without exceeding the chat limit", () => {
    const chunks = splitStatusMessage(`first\n${"x".repeat(31)}\nlast`, 10);
    assert.ok(chunks.every((chunk) => chunk.length <= 10));
    assert.equal(chunks[0], "first");
    assert.equal(chunks.at(-1), "last");
    assert.equal(chunks.slice(1, -1).join(""), "x".repeat(31));
  });
});
