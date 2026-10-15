import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { addStickerExif } from "../src/lib/stickers.js";

interface Chunk {
  fourcc: string;
  data: Buffer;
}

function readChunks(webp: Buffer): Chunk[] {
  assert.equal(webp.toString("ascii", 0, 4), "RIFF");
  assert.equal(webp.toString("ascii", 8, 12), "WEBP");
  assert.equal(webp.readUInt32LE(4), webp.length - 8, "RIFF size covers the whole file");

  const chunks: Chunk[] = [];
  let offset = 12;
  while (offset + 8 <= webp.length) {
    const fourcc = webp.toString("ascii", offset, offset + 4);
    const size = webp.readUInt32LE(offset + 4);
    chunks.push({ fourcc, data: webp.subarray(offset + 8, offset + 8 + size) });
    offset += 8 + size + (size % 2);
  }
  assert.equal(offset, webp.length, "chunks tile the whole file");
  return chunks;
}

// Minimal extended WebP: VP8X header (alpha set) followed by a VP8L image chunk.
function makeWebp(): Buffer {
  const vp8x = Buffer.from([0x10, 0x00, 0x00, 0x00, 0xff, 0x01, 0x00, 0xff, 0x01, 0x00]);
  const vp8l = Buffer.from([0x2f, 0x00, 0x00, 0x00, 0x00]);

  const build = (fourcc: string, data: Buffer): Buffer => {
    const header = Buffer.alloc(8);
    header.write(fourcc, 0, 4, "ascii");
    header.writeUInt32LE(data.length, 4);
    return Buffer.concat([header, data, ...(data.length % 2 === 1 ? [Buffer.from([0])] : [])]);
  };

  const body = Buffer.concat([build("VP8X", vp8x), build("VP8L", vp8l)]);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([riff, body]);
}

// Minimal simple-format WebP: a single lossy VP8 chunk for a 512x512 frame,
// like ffmpeg emits for an opaque static sticker (no VP8X header).
function makeSimpleWebp(): Buffer {
  const frame = Buffer.alloc(10);
  frame[3] = 0x9d;
  frame[4] = 0x01;
  frame[5] = 0x2a;
  frame.writeUInt16LE(512, 6);
  frame.writeUInt16LE(512, 8);

  const header = Buffer.alloc(8);
  header.write("VP8 ", 0, 4, "ascii");
  header.writeUInt32LE(frame.length, 4);

  const body = Buffer.concat([header, frame]);
  const riff = Buffer.alloc(12);
  riff.write("RIFF", 0, 4, "ascii");
  riff.writeUInt32LE(body.length + 4, 4);
  riff.write("WEBP", 8, 4, "ascii");
  return Buffer.concat([riff, body]);
}

function parseExif(data: Buffer): unknown {
  assert.equal(data.readUInt16LE(0), 0x4949, "little-endian TIFF marker");
  assert.equal(data.readUInt16LE(2), 0x002a, "TIFF magic");
  assert.equal(data.readUInt32LE(4), 8, "IFD offset");
  assert.equal(data.readUInt16LE(8), 1, "one IFD entry");
  assert.equal(data.readUInt16LE(10), 0x5741, "WhatsApp metadata tag");
  assert.equal(data.readUInt16LE(12), 7, "undefined type");
  assert.equal(data.readUInt32LE(18), 22, "value offset");
  const length = data.readUInt32LE(14);
  const json = data.subarray(22, 22 + length);
  assert.equal(Buffer.byteLength(json), length, "length matches the UTF-8 byte count");
  return JSON.parse(json.toString("utf8"));
}

describe("addStickerExif", () => {
  it("injects the pack metadata and flags EXIF in the VP8X header", () => {
    const output = addStickerExif(makeWebp(), {
      packId: "com.yuuri.bot.sticker",
      packName: "build with love❤",
      publisher: "Yuuri Bot",
    });

    const chunks = readChunks(output);
    const vp8x = chunks.find((chunk) => chunk.fourcc === "VP8X");
    assert.ok(vp8x, "keeps the VP8X header");
    assert.equal((vp8x.data[0] ?? 0) & 0x08, 0x08, "sets the EXIF feature flag");
    assert.equal((vp8x.data[0] ?? 0) & 0x10, 0x10, "keeps the alpha flag");

    const exif = chunks.find((chunk) => chunk.fourcc === "EXIF");
    assert.ok(exif, "adds an EXIF chunk");
    assert.deepEqual(parseExif(exif.data), {
      "sticker-pack-id": "com.yuuri.bot.sticker",
      "sticker-pack-name": "build with love❤",
      "sticker-pack-publisher": "Yuuri Bot",
      emojis: [],
    });
  });

  it("replaces an existing metadata chunk instead of adding a second", () => {
    const once = addStickerExif(makeWebp(), {
      packId: "a",
      packName: "one",
      publisher: "me",
    });
    const twice = addStickerExif(once, {
      packId: "b",
      packName: "two",
      publisher: "you",
    });

    const chunks = readChunks(twice);
    assert.equal(chunks.filter((chunk) => chunk.fourcc === "EXIF").length, 1);
    const exif = chunks.find((chunk) => chunk.fourcc === "EXIF");
    assert.ok(exif);
    assert.equal((parseExif(exif.data) as { "sticker-pack-name": string })["sticker-pack-name"], "two");
  });

  it("promotes a simple-format WebP to extended format with a VP8X header", () => {
    const output = addStickerExif(makeSimpleWebp(), {
      packId: "com.yuuri.bot.sticker",
      packName: "build with love❤",
      publisher: "Yuuri Bot",
    });

    const chunks = readChunks(output);
    assert.equal(chunks[0]?.fourcc, "VP8X", "VP8X becomes the first chunk");
    const vp8x = chunks[0];
    assert.ok(vp8x);
    assert.equal((vp8x.data[0] ?? 0) & 0x08, 0x08, "sets the EXIF feature flag");
    assert.equal(vp8x.data.readUIntLE(4, 3) + 1, 512, "carries the frame width");
    assert.equal(vp8x.data.readUIntLE(7, 3) + 1, 512, "carries the frame height");
    assert.ok(chunks.some((chunk) => chunk.fourcc === "EXIF"));
  });

  it("rejects input that is not a WebP", () => {
    assert.throws(() => addStickerExif(Buffer.from("not a webp at all"), {
      packId: "a",
      packName: "b",
      publisher: "c",
    }));
  });
});
