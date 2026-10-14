import { config } from "dotenv";
import { createBot } from "./bot.js";

config();

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error(
    "Missing BOT_TOKEN. Copy .env.example to .env and set your token from @BotFather.",
  );
  process.exit(1);
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
