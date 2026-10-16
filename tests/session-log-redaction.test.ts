import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  installSessionLogRedaction,
  redactSessionValue,
} from "../src/platform/whatsapp/logger.js";

function collectBuffers(value: unknown, found: Buffer[] = []): Buffer[] {
  if (Buffer.isBuffer(value)) {
    found.push(value);
    return found;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBuffers(item, found);
    return found;
  }
  if (value !== null && typeof value === "object") {
    for (const item of Object.values(value)) collectBuffers(item, found);
  }
  return found;
}

function fakeSession(): Record<string, unknown> {
  return {
    _chains: {
      peer: {
        chainKey: { chainKey: Buffer.from("secret-chain"), counter: 7 },
        messageKeys: { 1: Buffer.from("secret-key") },
        chainType: 1,
      },
    },
    registrationId: 1895002403,
    currentRatchet: {
      ephemeralKeyPair: { pubKey: Buffer.from("pub"), privKey: Buffer.from("secret-priv") },
      rootKey: Buffer.from("secret-root"),
      lastRemoteEphemeralKey: Buffer.from("remote"),
    },
    indexInfo: { baseKey: Buffer.from("base"), remoteIdentityKey: Buffer.from("id"), closed: -1 },
  };
}

describe("redactSessionValue", () => {
  it("leaves no buffer behind in a session dump", () => {
    const out = redactSessionValue(fakeSession());
    assert.equal(collectBuffers(out).length, 0);
  });

  it("redacts named secret fields and keeps non-secret ones", () => {
    const out = redactSessionValue(fakeSession()) as Record<string, any>;
    assert.equal(out.currentRatchet.ephemeralKeyPair.privKey, "[redacted]");
    assert.equal(out.currentRatchet.rootKey, "[redacted]");
    assert.equal(out._chains.peer.chainKey, "[redacted]");
    assert.equal(out._chains.peer.messageKeys, "[redacted]");
    assert.equal(out.registrationId, 1895002403);
    assert.equal(out.indexInfo.closed, -1);
  });

  it("does not hang on a circular object", () => {
    const value: Record<string, unknown> = { name: "a" };
    value.self = value;
    const out = redactSessionValue(value) as Record<string, unknown>;
    assert.equal(out.name, "a");
    assert.equal(out.self, "[redacted]");
  });
});

describe("installSessionLogRedaction", () => {
  it("redacts libsignal's session dumps but leaves other logs alone", () => {
    const logged: unknown[][] = [];
    const previousInfo = console.info;
    const previousWarn = console.warn;
    console.info = ((...args: unknown[]) => {
      logged.push(args);
    }) as never;
    console.warn = ((...args: unknown[]) => {
      logged.push(args);
    }) as never;

    try {
      installSessionLogRedaction();
      console.info("Closing session:", { privKey: Buffer.from("p"), rootKey: Buffer.from("r") });
      console.warn("Session already closed", { chainKey: Buffer.from("c") });
      console.info("Opening session:", { messageKeys: { 1: Buffer.from("m") } });
      console.info("unrelated debug", { privKey: Buffer.from("keep") });
    } finally {
      console.info = previousInfo;
      console.warn = previousWarn;
    }

    assert.equal(logged.length, 4);
    assert.equal(logged[0]![0], "Closing session:");
    assert.deepEqual(logged[0]![1], { privKey: "[redacted]", rootKey: "[redacted]" });
    assert.equal(logged[1]![0], "Session already closed");
    assert.deepEqual(logged[1]![1], { chainKey: "[redacted]" });
    assert.equal(logged[2]![0], "Opening session:");
    assert.deepEqual(logged[2]![1], { messageKeys: "[redacted]" });
    assert.deepEqual(logged[3]![1], { privKey: Buffer.from("keep") });
  });
});
