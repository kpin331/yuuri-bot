import { cpus, freemem, totalmem } from "node:os";
import { exec } from "./exec.js";

export interface SystemDiagnostics {
  processor: string;
  logicalCores: number;
  totalMemory: number;
  freeMemory: number;
  wifiSpeed: string;
  totalNodeMemory: number | null;
  nodeMemory: NodeJS.MemoryUsage;
}

const POWERSHELL_DIAGNOSTICS = [
  "$wifi = Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' -and ($_.Name -match 'Wi-?Fi|Wireless' -or $_.NdisPhysicalMedium -eq 9) } | Sort-Object LinkSpeed -Descending | Select-Object -First 1 -ExpandProperty LinkSpeed",
  "$nodeMemory = [long]0; Get-Process -Name node -ErrorAction SilentlyContinue | ForEach-Object { $nodeMemory += $_.WorkingSet64 }",
  "$wifiValue = if ($wifi) { [string]$wifi } else { 'tidak terdeteksi' }",
  "@{ wifi = $wifiValue; nodeMemory = $nodeMemory } | ConvertTo-Json -Compress -Depth 3",
].join("; ");

export async function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  const cores = cpus();
  let wifiSpeed = "tidak terdeteksi";
  let totalNodeMemory: number | null = null;

  if (process.platform === "win32") {
    try {
      const result = await exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", POWERSHELL_DIAGNOSTICS], {
        timeoutMs: 10_000,
        maxOutputBytes: 2 * 1024 * 1024,
      });
      const data = JSON.parse(result.stdout) as {
        wifi?: unknown;
        nodeMemory?: unknown;
      };
      if (typeof data.wifi === "string") wifiSpeed = data.wifi;
      if (typeof data.nodeMemory === "number" && Number.isFinite(data.nodeMemory)) totalNodeMemory = data.nodeMemory;
    } catch {
      // The ping reply still includes OS memory and Node.js memory if PowerShell is unavailable.
    }
  }

  return {
    processor: cores[0]?.model.trim() || process.arch,
    logicalCores: cores.length,
    totalMemory: totalmem(),
    freeMemory: freemem(),
    wifiSpeed,
    totalNodeMemory,
    nodeMemory: process.memoryUsage(),
  };
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export function formatSystemDiagnostics(responseMs: number, diagnostics: SystemDiagnostics): string {
  const lines = [
    `Waktu respons: ${responseMs} ms`,
    `Prosesor: ${diagnostics.processor} (${diagnostics.logicalCores} core logis)`,
    `RAM: ${formatBytes(diagnostics.totalMemory - diagnostics.freeMemory)} dipakai / ${formatBytes(diagnostics.totalMemory)} total`,
    `Wi-Fi speed: ${diagnostics.wifiSpeed}`,
    `Node.js memakai memori: ${diagnostics.totalNodeMemory === null ? "total proses tidak tersedia" : `total RSS ${formatBytes(diagnostics.totalNodeMemory)}`}; proses bot RSS ${formatBytes(diagnostics.nodeMemory.rss)}, heap ${formatBytes(diagnostics.nodeMemory.heapUsed)} / ${formatBytes(diagnostics.nodeMemory.heapTotal)}`,
  ];
  return lines.join("\n");
}

export function splitStatusMessage(text: string, maxLength = 3500): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (line.length > maxLength) {
      if (current) chunks.push(current);
      current = "";
      for (let index = 0; index < line.length; index += maxLength) {
        chunks.push(line.slice(index, index + maxLength));
      }
      continue;
    }
    if (current && current.length + line.length + 1 > maxLength) {
      chunks.push(current);
      current = "";
    }
    current += `${current ? "\n" : ""}${line}`;
  }
  if (current) chunks.push(current);
  return chunks;
}
