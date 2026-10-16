// Interactive setup and re-auth helper, run with `npm run setup`.
//
// Telegram: asks for the bot token (verified live against getMe) and the owner
// ID, then writes them into .env without touching the rest of the file.
// WhatsApp: asks for the owner number and lets you pick QR code or pairing-code
// login, reusing the same connection code the bot uses at startup.
import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface, type Interface } from "node:readline/promises";
import { config } from "dotenv";
import { getWaAuthDir } from "../src/lib/config.js";
import {
  buildEnvFile,
  normalizePhoneNumber,
  parseEnvFile,
  validateBotToken,
  validateNumericId,
  validatePhoneNumber,
} from "../src/lib/envfile.js";

const ENV_PATH = join(process.cwd(), ".env");
const TEMPLATE_PATH = join(process.cwd(), ".env.example");
const WA_LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

config();

async function ask(
  rl: Interface,
  question: string,
  options: { defaultValue?: string } = {},
): Promise<string> {
  const suffix = options.defaultValue !== undefined ? ` [${options.defaultValue}]` : "";
  const answer = (await rl.question(`${question}${suffix}: `)).trim();
  return answer.length > 0 ? answer : (options.defaultValue ?? "");
}

async function confirm(rl: Interface, question: string, defaultYes = true): Promise<boolean> {
  const answer = (await rl.question(`${question} [${defaultYes ? "Y/n" : "y/N"}]: `))
    .trim()
    .toLowerCase();
  if (answer.length === 0) return defaultYes;
  return answer === "y" || answer === "yes";
}

async function readExistingEnv(): Promise<string> {
  if (!existsSync(ENV_PATH)) return "";
  return readFile(ENV_PATH, "utf8");
}

async function writeEnv(updates: Record<string, string>): Promise<void> {
  const template = await readFile(TEMPLATE_PATH, "utf8");
  const existing = await readExistingEnv();
  await writeFile(ENV_PATH, buildEnvFile({ template, existing, updates }), "utf8");
}

async function verifyBotToken(
  token: string,
): Promise<{ username: string | null; error: string | null }> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json()) as {
      ok?: boolean;
      description?: string;
      result?: { username?: string };
    };
    if (body.ok && body.result?.username) return { username: body.result.username, error: null };
    return { username: null, error: body.description ?? `HTTP ${response.status}` };
  } catch (error) {
    return { username: null, error: error instanceof Error ? error.message : String(error) };
  }
}

async function promptToken(rl: Interface, suggested: string | undefined): Promise<string> {
  let token = suggested ?? "";
  if (token.length > 0) {
    const keep = await confirm(rl, `Keep the existing bot token (…${token.slice(-4)})?`);
    if (!keep) token = "";
  }

  while (token.length === 0 || validateBotToken(token) !== null) {
    if (token.length > 0) console.log(`  ${validateBotToken(token)}`);
    token = (await ask(rl, "Bot token from @BotFather")).trim();
  }

  while (true) {
    const { username, error } = await verifyBotToken(token);
    if (username) {
      console.log(`Token verified: @${username}`);
      return token;
    }
    console.log(`Could not verify the token: ${error}`);
    if (await confirm(rl, "Use it anyway?", false)) return token;

    token = "";
    while (token.length === 0 || validateBotToken(token) !== null) {
      if (token.length > 0) console.log(`  ${validateBotToken(token)}`);
      token = (await ask(rl, "Bot token from @BotFather")).trim();
    }
  }
}

async function telegramSetup(rl: Interface): Promise<void> {
  console.log("\n--- Telegram ---");
  const current = parseEnvFile(await readExistingEnv());

  const token = await promptToken(rl, current.get("BOT_TOKEN"));

  let ownerId = current.get("OWNER_ID") ?? "";
  if (ownerId.length > 0 && !(await confirm(rl, `Keep the existing owner ID (${ownerId})?`))) {
    ownerId = "";
  }
  while (validateNumericId(ownerId) !== null) {
    if (ownerId.length > 0) console.log(`  ${validateNumericId(ownerId)}`);
    ownerId = (await ask(rl, "Your Telegram user ID (message @userinfobot), digits only")).trim();
  }

  const everyoneByDefault = (current.get("EVERYONE") ?? "true").trim().toLowerCase() !== "false";
  const everyone = await confirm(rl, "Let everyone use the bot (EVERYONE)", everyoneByDefault);

  await writeEnv({
    BOT_TOKEN: token,
    OWNER_ID: ownerId,
    EVERYONE: everyone ? "true" : "false",
  });
  console.log("Telegram settings saved to .env");
}

async function hasRegisteredSession(authDir: string): Promise<boolean> {
  const credsPath = join(authDir, "creds.json");
  if (!existsSync(credsPath)) return false;
  try {
    const creds = JSON.parse(await readFile(credsPath, "utf8")) as { registered?: boolean };
    return creds.registered === true;
  } catch {
    return false;
  }
}

async function waitForLogin(pairing: boolean): Promise<void> {
  const { connectWhatsApp } = await import("../src/platform/whatsapp/connection.js");
  console.log(
    pairing
      ? "Requesting a pairing code… (enter it in WhatsApp > Linked devices > Link with phone number)"
      : "Waiting for a QR scan… (WhatsApp > Linked devices > Link a device)",
  );

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void connection.close().finally(() => {
        if (error) reject(error);
        else resolve();
      });
    };
    const timer = setTimeout(() => {
      console.log("Timed out waiting for WhatsApp login.");
      finish(new Error("WhatsApp login timed out"));
    }, WA_LOGIN_TIMEOUT_MS);
    const connection = connectWhatsApp({
      onIncoming: async () => undefined,
      onOpen: () => finish(),
    });
  });
}

async function whatsappSetup(rl: Interface): Promise<void> {
  console.log("\n--- WhatsApp ---");
  const authDir = getWaAuthDir();

  if (await hasRegisteredSession(authDir)) {
    console.log(`A WhatsApp session already exists in "${authDir}".`);
    if (!(await confirm(rl, "Log in again? This replaces the current session.", false))) {
      console.log("Keeping the existing WhatsApp session.");
      return;
    }
    await rm(authDir, { recursive: true, force: true });
    console.log("Old session removed.");
  }

  const current = parseEnvFile(await readExistingEnv());
  let number = normalizePhoneNumber(current.get("OWNER_NUMBER") ?? "");
  while (validatePhoneNumber(number) !== null) {
    if (number.length > 0) console.log(`  ${validatePhoneNumber(number)}`);
    number = normalizePhoneNumber(
      await ask(rl, "WhatsApp owner number (international format, digits only, e.g. 6281234567890)"),
    );
  }

  const mode = await ask(rl, "Login method: 1) QR code, 2) pairing code", { defaultValue: "1" });
  const pairing = mode.trim() === "2";

  process.env.OWNER_NUMBER = number;
  if (pairing) {
    process.env.PAIRING_NUMBER = number;
    await writeEnv({ OWNER_NUMBER: number, PAIRING_NUMBER: number });
  } else {
    delete process.env.PAIRING_NUMBER;
    await writeEnv({ OWNER_NUMBER: number, PAIRING_NUMBER: "" });
  }

  await waitForLogin(pairing);
  console.log("WhatsApp login complete. The session is stored in the auth folder.");
}

async function main(): Promise<void> {
  if (!existsSync(TEMPLATE_PATH)) {
    throw new Error("Run this from the project root (.env.example is missing).");
  }

  const rl = createInterface({ input, output });
  rl.on("SIGINT", () => {
    console.log("\nAborted.");
    process.exit(130);
  });

  try {
    console.log("=== Yuuri Bot setup ===");
    const choice = (
      await ask(rl, "Choose 1) Telegram  2) WhatsApp  3) Both  0) Exit", { defaultValue: "3" })
    ).trim();

    switch (choice) {
      case "1":
        await telegramSetup(rl);
        break;
      case "2":
        await whatsappSetup(rl);
        break;
      case "3":
        await telegramSetup(rl);
        await whatsappSetup(rl);
        break;
      case "0":
        return;
      default:
        console.log("Unknown choice. Run `npm run setup` again.");
        return;
    }

    console.log("\nDone. Start the bot with `npm run dev` (or `npm start` after `npm run build`).");
  } finally {
    rl.close();
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
