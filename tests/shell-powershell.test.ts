import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { handleShellMessage, type ShellMessageContext } from "../src/platform/shell.js";

function context(text: string, isOwner: boolean, replies: string[]): ShellMessageContext {
  return {
    platform: "telegram",
    userId: isOwner ? "1" : "2",
    chatId: "10",
    isOwner,
    isPrivate: true,
    text,
    reply: async (message) => { replies.push(message); },
    sendSecretPhoto: async () => undefined,
  };
}

describe("owner PowerShell command", () => {
  it("rejects non-owners before starting a process", async () => {
    const replies: string[] = [];
    assert.equal(await handleShellMessage(context("POWERSHELL: Get-Process", false, replies)), true);
    assert.match(replies[0] ?? "", /Hanya pemilik bot/);
  });

  it("requires a command body", async () => {
    const replies: string[] = [];
    assert.equal(await handleShellMessage(context("POWERSHELL:", true, replies)), true);
    assert.match(replies[0] ?? "", /Format: POWERSHELL:/);

    const wrappedReplies: string[] = [];
    assert.equal(await handleShellMessage(context("POWERSHELL: {   }", true, wrappedReplies)), true);
    assert.match(wrappedReplies[0] ?? "", /Format: POWERSHELL:/);
  });

  it("starts a fresh session, sends running first, then returns the command output", {
    skip: process.platform !== "win32",
  }, async () => {
    const replies: string[] = [];
    assert.equal(
      await handleShellMessage(context('POWERSHELL: {Write-Output "POWERSHELL_TEST_OK"}', true, replies)),
      true,
    );
    assert.equal(replies[0], "running...");
    assert.ok(replies.some((reply) => reply.includes("Selesai (exit code 0).")));
    assert.ok(replies.some((reply) => reply.includes("POWERSHELL_TEST_OK")));
  });
});
