import { getOwnerNumbers, getPairingNumber } from "./lib/config.js";
import { connectWhatsApp, type WhatsAppConnection } from "./platform/whatsapp/connection.js";
import { handleIncoming } from "./platform/whatsapp/router.js";

// Starts the WhatsApp side of the bot when it is configured. The bot shares its
// database, quota and command-state with the Telegram side, so both platforms
// behave the same way.
export function startWhatsApp(): WhatsAppConnection | null {
  const ownerNumbers = getOwnerNumbers();
  const pairing = getPairingNumber();

  if (ownerNumbers.length === 0 && !pairing) {
    console.log(
      "WhatsApp not started: set OWNER_NUMBER (and optionally PAIRING_NUMBER) in .env to enable it.",
    );
    return null;
  }

  return connectWhatsApp({ onIncoming: handleIncoming });
}
