import { appendFile, copyFile, lstat, mkdir, open, readdir, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { networkInterfaces } from "node:os";

export interface RuntimeOptions {
  saveMedia: boolean;
  mediaDirectory: string;
  log: boolean;
}

export function parseRuntimeArgs(args: string[], cwd = process.cwd()): RuntimeOptions {
  let saveMedia = false;
  let mediaDirectory = join(cwd, "Media");
  let log = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-S") {
      saveMedia = true;
      const drive = args[index + 1];
      if (drive && /^[A-Za-z]:$/.test(drive)) {
        mediaDirectory = `${drive.toUpperCase()}\\Media`;
        index += 1;
      }
    } else if (arg === "--log") {
      log = true;
    } else {
      throw new Error(`Argumen tidak dikenal: ${arg}`);
    }
  }

  return { saveMedia, mediaDirectory, log };
}

let options: RuntimeOptions = {
  saveMedia: false,
  mediaDirectory: join(process.cwd(), "Media"),
  log: false,
};
let logReady: Promise<void> = Promise.resolve();
let consoleWrapped = false;
let wrappedFetch: typeof fetch | null = null;
let originalFetch: typeof fetch | null = null;
const pendingTelemetry: Promise<void>[] = [];
const pendingMediaWrites = new Set<Promise<void>>();

export function configureRuntime(next: RuntimeOptions): void {
  options = next;
  if (options.log && globalThis.fetch !== wrappedFetch) {
    originalFetch = globalThis.fetch.bind(globalThis);
    wrappedFetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const baseFetch = originalFetch;
      if (!options.log || !baseFetch) return baseFetch!(input, init);

      const urlText = input instanceof Request ? input.url : String(input);
      let url: URL | null = null;
      try {
        url = new URL(urlText);
      } catch {
        // Omit malformed URL details because they can contain user supplied input.
      }
      if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
        return baseFetch(input, init);
      }

      const host = url.hostname;
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const requestBytes = requestBodySize(
        init?.body,
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      const started = Date.now();
      const dnsPromise = lookupHost(host);

      try {
        const response = await baseFetch(input, init);
        const finalHost = response.url ? safeHost(response.url) : host;
        const finalDnsPromise = finalHost === host ? dnsPromise : lookupHost(finalHost);
        trackRuntimeTelemetry(Promise.all([dnsPromise, finalDnsPromise]).then(([dns, finalDns]) => {
          writeLog(
            "FETCH",
            `method=${method} host=${host} final_host=${finalHost} dns_ips=${dns.ips.join(",") || "unavailable"} final_dns_ips=${finalDns.ips.join(",") || "unavailable"} dns_error=${dns.error ?? "none"} final_dns_error=${finalDns.error ?? "none"} status=${response.status} request_bytes=${requestBytes ?? "unknown"} response_content_length=${response.headers.get("content-length") ?? "unknown"} duration_ms=${Date.now() - started}`,
          );
        }));
        return response;
      } catch (error) {
        trackRuntimeTelemetry(dnsPromise.then((dns) => {
          writeLog(
            "FETCH",
            `method=${method} host=${host} dns_ips=${dns.ips.join(",") || "unavailable"} dns_error=${dns.error ?? "none"} status=network_error request_bytes=${requestBytes ?? "unknown"} duration_ms=${Date.now() - started}`,
          );
        }));
        throw error;
      }
    };
    globalThis.fetch = wrappedFetch;
  }

  if (options.log && !consoleWrapped) {
    consoleWrapped = true;
    for (const method of ["log", "info", "warn", "error"] as const) {
      console[method] = ((...values: unknown[]) => {
        const detail = method === "error" || method === "warn"
          ? `${method} event (details omitted)`
          : values.map(formatValue).join(" ");
        writeLog(`CLI/${method.toUpperCase()}`, detail);
      }) as typeof console[typeof method];
    }
  }
}

function safeHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return "unknown";
  }
}

function requestBodySize(body: RequestInit["body"], headers?: RequestInit["headers"]): number | null {
  if (body === null || body === undefined) return 0;
  if (typeof body === "string") return Buffer.byteLength(body);
  if (body instanceof URLSearchParams) return Buffer.byteLength(body.toString());
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (typeof Blob !== "undefined" && body instanceof Blob) return body.size;
  const headerLength = new Headers(headers).get("content-length");
  if (headerLength && /^\d+$/.test(headerLength)) return Number(headerLength);
  return null;
}

export async function lookupHost(host: string): Promise<{ ips: string[]; error?: string }> {
  const unbracketed = host.replace(/^\[|\]$/g, "");
  if (isIP(unbracketed)) return { ips: [unbracketed] };
  try {
    const results = await lookup(unbracketed, { all: true, verbatim: true });
    return { ips: [...new Set(results.map((item) => item.address))] };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "lookup_failed";
    return { ips: [], error: code };
  }
}

export function logRuntimeEnvironment(programs: Record<string, boolean>): void {
  if (!options.log) return;
  const addresses = Object.values(networkInterfaces())
    .flatMap((items) => items ?? [])
    .filter((item) => !item.internal)
    .map((item) => `${item.family}:${item.address}`);
  writeLog(
    "BACKEND",
    `node=${process.version} platform=${process.platform}/${process.arch} pid=${process.pid} local_ips=${addresses.join(",") || "unavailable"} sender_ip=not_exposed_by_platform programs=${Object.entries(programs).map(([name, available]) => `${name}:${available ? "available" : "missing"}`).join(",")}`,
  );
}

export function runtimeOptions(): RuntimeOptions {
  return options;
}

function formatValue(value: unknown): string {
  if (value instanceof Error) return redact(`${value.name}: ${value.message}`);
  if (typeof value === "string") return redact(value);
  try {
    return redact(JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

function redact(value: string): string {
  return value
    .replace(/\/bot\d+:[A-Za-z0-9_-]+/g, "/bot[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/Kode penautan WhatsApp untuk [^:]+:\s*\S+/gi, "Kode penautan WhatsApp [redacted]")
    .replace(/(BOT_TOKEN\s*[=:]\s*)\S+/gi, "$1[redacted]");
}

export function writeLog(event: string, detail: string): void {
  if (!options.log) return;
  const line = `${new Date().toISOString()} [${event}] ${redact(detail).replace(/[\r\n]+/g, " ")}\n`;
  process.stdout.write(line);
  logReady = logReady
    .then(() => appendFile(resolve(process.cwd(), "bot.log"), line, "utf8"))
    .catch((error: unknown) => {
      process.stderr.write(`${new Date().toISOString()} [ERROR] Gagal menulis bot.log: ${formatValue(error)}\n`);
    });
}

export function trackRuntimeTelemetry(task: Promise<void>): void {
  pendingTelemetry.push(task);
}

function trackMediaWrite(task: Promise<void>): Promise<void> {
  pendingMediaWrites.add(task);
  void task.then(
    () => pendingMediaWrites.delete(task),
    () => pendingMediaWrites.delete(task),
  );
  return task;
}

function mediaDestination(name: string): string {
  const safeName = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, "_");
  const extension = safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : "";
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  return join(options.mediaDirectory, `${stem}-${randomUUID()}${extension}`);
}

async function syncFile(path: string): Promise<void> {
  const file = await open(path, "r+");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}

export function saveMediaFile(path: string, name = basename(path)): Promise<void> {
  if (!options.saveMedia) return Promise.resolve();
  return trackMediaWrite((async () => {
    await mkdir(options.mediaDirectory, { recursive: true });
    const destination = mediaDestination(name);
    await copyFile(path, destination);
    await syncFile(destination);
    writeLog("MEDIA", `disimpan ${destination}`);
  })());
}

export function saveMediaBuffer(buffer: Buffer, name: string): Promise<void> {
  if (!options.saveMedia) return Promise.resolve();
  return trackMediaWrite((async () => {
    await mkdir(options.mediaDirectory, { recursive: true });
    const destination = mediaDestination(name);
    await writeFile(destination, buffer);
    await syncFile(destination);
    writeLog("MEDIA", `disimpan ${destination}`);
  })());
}

export async function archiveMediaBuffer(buffer: Buffer, name: string): Promise<void> {
  try {
    await saveMediaBuffer(buffer, name);
  } catch (error) {
    console.error(`Gagal menyimpan media ${name}:`, error);
  }
}

export async function archiveMediaFile(path: string, name?: string): Promise<void> {
  try {
    await saveMediaFile(path, name);
  } catch (error) {
    console.error(`Gagal menyimpan media ${name ?? basename(path)}:`, error);
  }
}

export async function flushRuntimeLogs(): Promise<void> {
  while (pendingTelemetry.length > 0) {
    await Promise.allSettled(pendingTelemetry.splice(0));
  }
  await logReady;
}

export async function flushRuntimeMedia(): Promise<void> {
  while (pendingMediaWrites.size > 0) {
    await Promise.allSettled([...pendingMediaWrites]);
  }
}

export async function purgeSavedMedia(): Promise<number> {
  await flushRuntimeMedia();
  const directory = resolve(options.mediaDirectory);
  if (basename(directory).toLowerCase() !== "media") {
    throw new Error("Lokasi arsip media tidak aman untuk dibersihkan.");
  }

  let directoryInfo: Awaited<ReturnType<typeof lstat>>;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }
  if (!directoryInfo.isDirectory()) {
    throw new Error("Lokasi arsip media bukan folder biasa.");
  }

  const entries = await readdir(directory, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    await unlink(join(directory, entry.name));
    removed += 1;
  }
  return removed;
}

