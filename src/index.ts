import { config } from "dotenv";
import { createBot } from "./bot.js";
import { closeDatabase, initDatabase } from "./lib/db.js";
import { checkRequiredTools } from "./lib/tools.js";

config();

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error(
    "Missing BOT_TOKEN. Copy .env.example to .env and set your token from @BotFather.",
  );
  process.exit(1);
}

const missingTools = await checkRequiredTools();
if (missingTools.length > 0) {
  console.warn(
    `Warning: missing required tools: ${missingTools.join(", ")}. ` +
      "Sticker and download commands will not work until they are installed.",
  );
}

try {
  initDatabase();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Warning: could not open the storage database (${reason}). User statistics will be unavailable.`);
}

const bot = createBot(token);

await bot.init();
console.log(`Bot started as @${bot.botInfo.username}`);

const shutdown = (): void => {
  closeDatabase();
  void bot.stop();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.start({
  onStart: (botInfo) => {
    console.log(`Polling for updates... (@${botInfo.username})`);
  },
});
