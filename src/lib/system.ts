import { statfs } from "node:fs/promises";
import { parse } from "node:path";
import {
  arch,
  cpus,
  freemem,
  hostname,
  platform,
  release,
  totalmem,
  type as osType,
  uptime,
} from "node:os";
import { escapeHtml } from "./info.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

function formatBytes(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return "Tidak diketahui";
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${BYTE_UNITS[unit]}`;
}

function percent(used: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((used / total) * 100)}%`;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "Tidak diketahui";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} hari`);
  if (days > 0 || hours > 0) parts.push(`${hours} jam`);
  parts.push(`${minutes} menit`);
  return parts.join(" ");
}

async function describeStorage(): Promise<string> {
  try {
    const root = parse(process.cwd()).root || "/";
    const stats = await statfs(root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;
    if (total <= 0) return "Tidak diketahui";
    return `${formatBytes(used)} / ${formatBytes(total)} (${percent(used, total)}) — ${root}`;
  } catch {
    return "Tidak diketahui";
  }
}

// Builds the system report shared by the Telegram and WhatsApp "$sys"/".sys"
// commands. Returns HTML; the WhatsApp adapter converts it to WhatsApp markup.
export async function buildSystemReport(): Promise<string> {
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model.trim() || "Tidak diketahui";
  const cpuCount = cpuList.length;

  const totalRam = totalmem();
  const freeRam = freemem();
  const usedRam = totalRam - freeRam;

  const lines = [
    "🖥 <b>Info Sistem</b>",
    `<b>Perangkat</b>: ${escapeHtml(hostname())}`,
    `<b>Sistem operasi</b>: ${escapeHtml(`${osType()} ${release()} (${platform()} ${arch()})`)}`,
    `<b>Prosesor</b>: ${escapeHtml(cpuModel)} — ${cpuCount} inti`,
    `<b>RAM</b>: ${formatBytes(usedRam)} / ${formatBytes(totalRam)} (${percent(usedRam, totalRam)})`,
    `<b>Penyimpanan</b>: ${escapeHtml(await describeStorage())}`,
    `<b>Waktu aktif sistem</b>: ${formatDuration(uptime())}`,
    `<b>Waktu aktif bot</b>: ${formatDuration(process.uptime())}`,
    `<b>Node</b>: ${process.version} (${process.platform} ${process.arch})`,
  ];
  return lines.join("\n");
}
