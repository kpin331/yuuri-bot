import { pino } from "pino";

// A quiet logger shared by the socket, media downloads and the connection code.
// Baileys is very chatty, so the default is "silent"; set WA_LOG_LEVEL=info (or
// debug) to see what it is doing while troubleshooting.
export const logger = pino({ level: process.env.WA_LOG_LEVEL?.trim() || "silent" });
