import { config } from "dotenv";
import { createBot } from "./bot.js";
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

const bot = createBot(token);

await bot.init();
console.log(`Bot started as @${bot.botInfo.username}`);

process.once("SIGINT", () => void bot.stop());
process.once("SIGTERM", () => void bot.stop());

await bot.start({
  onStart: (botInfo) => {
    console.log(`Polling for updates... (@${botInfo.username})`);
  },
});
