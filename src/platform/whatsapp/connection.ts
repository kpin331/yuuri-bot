import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  useMultiFileAuthState,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcode from "qrcode-terminal";
import { getPairingNumber, getWaAuthDir } from "../../lib/config.js";
import { extractIncoming } from "./message.js";
import { logger } from "./logger.js";
import type { IncomingMessage } from "./types.js";

export interface ConnectionOptions {
  onIncoming: (message: IncomingMessage) => Promise<void>;
}

export interface WhatsAppConnection {
  close: () => Promise<void>;
}

// Opens the WhatsApp socket and keeps it alive. On a dropped connection it
// reconnects automatically; on an explicit logout it stops and asks the user to
// clear the session folder. Login can be either a QR code in the terminal or a
// pairing code (when PAIRING_NUMBER is set).
// Maps a disconnect status code to its DisconnectReason name for logging.
function reasonName(statusCode: number | undefined): string {
  if (statusCode === undefined) return "unknown";
  for (const [name, value] of Object.entries(DisconnectReason)) {
    if (value === statusCode) return name;
  }
  return "unknown";
}

export function connectWhatsApp(options: ConnectionOptions): WhatsAppConnection {
  let socket: WASocket | null = null;
  let stopped = false;
  let opening = false;

  const handleStatus = (statusCode: number | undefined): void => {
    if (stopped) return;
    if (statusCode === DisconnectReason.loggedOut) {
      console.error(
        "WhatsApp logged out. Delete the session folder (WA_AUTH_DIR) and restart to log in again.",
      );
      stopped = true;
      return;
    }
    open();
  };

  const handleMessages = async (messages: IncomingMessage[]): Promise<void> => {
    for (const message of messages) {
      try {
        await options.onIncoming(message);
      } catch (error) {
        console.error("WhatsApp message handling failed:", error);
      }
    }
  };

  const open = (): void => {
    if (opening) return;
    opening = true;
    void (async () => {
      const { state, saveCreds } = await useMultiFileAuthState(getWaAuthDir());
      const { version } = await fetchLatestBaileysVersion();
      const pairingNumber = getPairingNumber();

      const sock = makeWASocket({
        version,
        logger,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
      socket = sock;

      sock.ev.on("creds.update", saveCreds);

      sock.ev.on("messages.upsert", ({ messages, type }) => {
        if (type !== "notify") return;
        const incoming: IncomingMessage[] = [];
        for (const raw of messages) {
          const message = extractIncoming(sock, raw);
          if (message) incoming.push(message);
        }
        void handleMessages(incoming);
      });

      sock.ev.on("connection.update", (update) => {
        if (update.qr && !pairingNumber) {
          console.log("Scan this QR code with WhatsApp (Linked devices):");
          qrcode.generate(update.qr, { small: true });
        }
        if (update.connection === "open") {
          console.log("WhatsApp connected.");
        }
        if (update.connection === "close") {
          const statusCode = (update.lastDisconnect?.error as { output?: { statusCode?: number } })
            ?.output?.statusCode;
          const reason = reasonName(statusCode);
          console.log(`WhatsApp connection closed (status ${statusCode ?? "unknown"}: ${reason}).`);
          handleStatus(statusCode);
        }
      });

      if (pairingNumber && !state.creds.registered) {
        setTimeout(() => {
          sock
            .requestPairingCode(pairingNumber)
            .then((code) => {
              console.log(`WhatsApp pairing code for ${pairingNumber}: ${code}`);
            })
            .catch((error) => {
              console.error("requestPairingCode failed:", error);
            });
        }, 3000);
      }
    })()
      .catch((error) => {
        console.error("WhatsApp connection failed:", error);
        if (!stopped) {
          console.log("Retrying WhatsApp connection in 5s…");
          setTimeout(open, 5000);
        }
      })
      .finally(() => {
        opening = false;
      });
  };

  open();

  return {
    close: async (): Promise<void> => {
      stopped = true;
      if (socket) await socket.end(undefined);
    },
  };
}
