import { getOwnerNumbers, getPairingNumber } from "./lib/config.js";
import { connectWhatsApp, type WhatsAppConnection } from "./platform/whatsapp/connection.js";
import { handleIncoming } from "./platform/whatsapp/router.js";
import type { WASocket } from "@whiskeysockets/baileys";

// Starts the WhatsApp side of the bot when it is configured. The bot shares its
// database, quota and command-state with the Telegram side, so both platforms
// behave the same way.
export function startWhatsApp(onOpen?: (socket: WASocket) => void): WhatsAppConnection | null {
  const ownerNumbers = getOwnerNumbers();
  const pairing = getPairingNumber();

  if (ownerNumbers.length === 0 && !pairing) {
    console.log(
      "WhatsApp tidak dijalankan: isi OWNER_NUMBER (dan opsional PAIRING_NUMBER) di .env untuk mengaktifkannya.",
    );
    return null;
  }

  return connectWhatsApp({ onIncoming: handleIncoming, onOpen });
}
