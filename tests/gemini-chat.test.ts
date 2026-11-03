import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  generateGeminiReply,
  GeminiChatError,
  geminiChatErrorMessage,
} from "../src/lib/gemini-chat.js";

const originalApi = process.env.GEMINI_API;
const originalModel = process.env.GEMINI_MODEL;
const originalFetch = globalThis.fetch;

afterEach(() => {
  if (originalApi === undefined) delete process.env.GEMINI_API;
  else process.env.GEMINI_API = originalApi;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
  globalThis.fetch = originalFetch;
});

describe("Gemini chat service", () => {
  it("sends the key in a header and includes short context for the same platform user", async () => {
    process.env.GEMINI_API = "test-secret";
    delete process.env.GEMINI_MODEL;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (input, init) => {
      requests.push({ url: String(input), init });
      const requestNumber = requests.length;
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ reply: `jawaban-${requestNumber}`, stickerName: "" }) }] } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    assert.equal((await generateGeminiReply("telegram", "gemini-test-user", "halo")).text, "jawaban-1");
    assert.equal((await generateGeminiReply("telegram", "gemini-test-user", "lanjut")).text, "jawaban-2");
    assert.equal((await generateGeminiReply("telegram", "gemini-owner-test-user", "apa kabar", "private", true)).text, "jawaban-3");
    assert.equal(requests[0]?.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent");
    assert.equal(new Headers(requests[0]?.init?.headers).get("x-goog-api-key"), "test-secret");
    const contents = JSON.parse(String(requests[1]?.init?.body)).contents as Array<{ role: string; parts: Array<{ text: string }> }>;
    const body = JSON.parse(String(requests[0]?.init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
      generationConfig: { responseMimeType: string; responseSchema: { properties: Record<string, unknown> } };
    };
    assert.match(body.systemInstruction.parts[0]?.text ?? "", /YuuriBot.*mommy.*tsundere/);
    assert.match(body.systemInstruction.parts[0]?.text ?? "", /Lawan bicaramu bukan pemilik bot/);
    const ownerBody = JSON.parse(String(requests[2]?.init?.body)) as {
      systemInstruction: { parts: Array<{ text: string }> };
    };
    assert.match(ownerBody.systemInstruction.parts[0]?.text ?? "", /Lawan bicaramu adalah developer\/pemilik bot.*panggil dia Dek/);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.deepEqual(contents.map((item) => [item.role, item.parts[0]?.text]), [
      ["user", "halo"],
      ["model", "jawaban-1"],
      ["user", "lanjut"],
    ]);
  });

  it("rejects missing keys and oversized messages before making a request", async () => {
    delete process.env.GEMINI_API;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response();
    }) as typeof fetch;
    await assert.rejects(generateGeminiReply("telegram", "missing-key-user", "hai"), (error: unknown) =>
      error instanceof GeminiChatError && error.kind === "not-configured");

    process.env.GEMINI_API = "test-secret";
    await assert.rejects(generateGeminiReply("telegram", "long-prompt-user", "a".repeat(4001)), (error: unknown) =>
      error instanceof GeminiChatError && error.kind === "input-too-long");
    assert.equal(called, false);
  });

  it("maps Gemini rate-limit responses to a safe user message", async () => {
    process.env.GEMINI_API = "test-secret";
    globalThis.fetch = (async () => new Response("private provider details", { status: 429 })) as typeof fetch;
    await assert.rejects(generateGeminiReply("whatsapp", "quota-user", "hai"), (error: unknown) =>
      error instanceof GeminiChatError && error.kind === "quota");
    assert.equal(geminiChatErrorMessage(new GeminiChatError("quota")), "Batas penggunaan Gemini sedang tercapai. Coba lagi nanti.");
    assert.equal(geminiChatErrorMessage(new Error("test-secret")), "AI sedang tidak bisa menjawab. Coba lagi nanti.");
  });
});
