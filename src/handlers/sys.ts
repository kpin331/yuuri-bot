import { statfs } from "node:fs/promises";
import { parse } from "node:path";
import { arch, cpus, freemem, hostname, platform, release, totalmem, type as osType, uptime } from "node:os";
import type { Bot, Context } from "grammy";
import { registerOwnerCommand } from "../lib/command.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function formatBytes(bytes: number): string {
  if (bytes < 0 || !Number.isFinite(bytes)) return "Unknown";
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
  if (!Number.isFinite(seconds) || seconds < 0) return "Unknown";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

async function describeStorage(): Promise<string> {
  try {
    const root = parse(process.cwd()).root || "/";
    const stats = await statfs(root);
    const total = stats.blocks * stats.bsize;
    const free = stats.bavail * stats.bsize;
    const used = total - free;
    if (total <= 0) return "Unknown";
    return `${formatBytes(used)} / ${formatBytes(total)} (${percent(used, total)}) — ${root}`;
  } catch {
    return "Unknown";
  }
}

async function buildReport(): Promise<string> {
  const cpuList = cpus();
  const cpuModel = cpuList[0]?.model.trim() || "Unknown";
  const cpuCount = cpuList.length;

  const totalRam = totalmem();
  const freeRam = freemem();
  const usedRam = totalRam - freeRam;

  const lines = [
    "🖥 <b>System Info</b>",
    `<b>Device</b>: ${escapeHtml(hostname())}`,
    `<b>OS</b>: ${escapeHtml(`${osType()} ${release()} (${platform()} ${arch()})`)}`,
    `<b>Processor</b>: ${escapeHtml(cpuModel)} — ${cpuCount} cores`,
    `<b>RAM</b>: ${formatBytes(usedRam)} / ${formatBytes(totalRam)} (${percent(usedRam, totalRam)})`,
    `<b>Storage</b>: ${escapeHtml(await describeStorage())}`,
    `<b>Uptime</b>: ${formatDuration(uptime())}`,
    `<b>Bot uptime</b>: ${formatDuration(process.uptime())}`,
    `<b>Node</b>: ${process.version} (${process.platform} ${process.arch})`,
  ];
  return lines.join("\n");
}

export function registerSys(bot: Bot): void {
  registerOwnerCommand(bot, "sys", async (ctx: Context) => {
    const report = await buildReport();
    await ctx.reply(report, { parse_mode: "HTML" });
  });
}
