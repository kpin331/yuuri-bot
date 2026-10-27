import { config } from "dotenv";
import { createBot } from "./bot.js";
import { closeDatabase, initDatabase } from "./lib/db.js";
import { checkRequiredTools, TOOLS } from "./lib/tools.js";
import { closePostgres, initPostgres } from "./lib/postgres.js";
import { startWhatsApp } from "./whatsapp.js";
import { configureRuntime, flushRuntimeLogs, flushRuntimeMedia, logRuntimeEnvironment, parseRuntimeArgs, runtimeOptions, writeLog } from "./lib/runtime.js";

config();

try {
  configureRuntime(parseRuntimeArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
writeLog("STARTUP", "bot starting");
if (runtimeOptions().saveMedia) {
  console.log(`Media disimpan di: ${runtimeOptions().mediaDirectory}`);
}

const token = process.env.BOT_TOKEN;

if (!token) {
  console.error(
    "BOT_TOKEN belum diisi. Salin .env.example menjadi .env lalu masukkan token dari @BotFather.",
  );
  process.exit(1);
}

const missingTools = await checkRequiredTools();
logRuntimeEnvironment(
  Object.fromEntries(Object.keys(TOOLS).map((name) => [name, !missingTools.includes(name as keyof typeof TOOLS)])),
);
if (missingTools.length > 0) {
  console.warn(
    `Peringatan: alat yang diperlukan belum tersedia: ${missingTools.join(", ")}. ` +
      "Perintah stiker dan unduhan tidak akan berfungsi sebelum alat tersebut dipasang.",
  );
}

try {
  initDatabase();
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  console.warn(`Peringatan: basis data penyimpanan tidak dapat dibuka (${reason}). Statistik pengguna tidak tersedia.`);
}

await initPostgres();

const bot = createBot(token);

await bot.init();
console.log(`Bot berjalan sebagai @${bot.botInfo.username}`);

const whatsapp = startWhatsApp();

let shuttingDown = false;
const shutdown = async (): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  writeLog("SHUTDOWN", "bot stopping");
  await Promise.allSettled([bot.stop(), whatsapp?.close()]);
  await flushRuntimeMedia();
  closeDatabase();
  await closePostgres();
  await flushRuntimeLogs();
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

await bot.start({
  onStart: (botInfo) => {
    console.log(`Menunggu pembaruan... (@${botInfo.username})`);
  },
});
