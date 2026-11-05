import { getCommandPrefix } from "../../../lib/config.js";
import { calculate, chooseOption, flipCoin } from "../../../lib/quick-tools.js";
import { replyTo, sendText } from "../reply.js";
import type { WaCommand } from "../types.js";

export const flipCommand: WaCommand = {
  name: "flip",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    if (args.trim()) {
      await sendText(replyTo(message), `Gunakan ${getCommandPrefix()}flip tanpa argumen untuk melempar koin.`);
      return;
    }
    await sendText(replyTo(message), `Hasil lemparan koin: ${flipCoin()}.`);
  },
};

export const chooseCommand: WaCommand = {
  name: "choose",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const result = chooseOption(args);
    if (!result) {
      await sendText(replyTo(message), `Format: ${getCommandPrefix()}choose opsi 1 | opsi 2 | ... (2-20 opsi, maksimal 120 karakter per opsi).`);
      return;
    }
    await sendText(replyTo(message), `Pilihan acak: ${result.choice}`);
  },
};

export const calcCommand: WaCommand = {
  name: "calc",
  free: true,
  awardXp: false,
  run: async ({ message, args }) => {
    const result = calculate(args);
    if (result === null) {
      await sendText(replyTo(message), `Format: ${getCommandPrefix()}calc <ekspresi>. Mendukung +, -, *, /, %, ^, dan tanda kurung; hasil dibatasi sampai 1.000.000.000.000.`);
      return;
    }
    await sendText(replyTo(message), `Hasil: ${Number(result.toPrecision(12))}`);
  },
};
