import { spawn } from "node:child_process";
import { basename } from "node:path";
import { lookupHost, runtimeOptions, trackRuntimeTelemetry, writeLog } from "./runtime.js";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

export function exec(
  command: string,
  args: string[],
  options: ExecOptions = {},
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const program = basename(command);
    const flags = args.filter((arg) => /^-{1,2}[A-Za-z]/.test(arg)).join(",") || "none";
    const destinations = [...new Set(args.flatMap((arg) => {
      try {
        return [new URL(arg).hostname];
      } catch {
        return [];
      }
    }))];
    writeLog("PROCESS", `program=${program} event=start flags=${flags} arg_count=${args.length} timeout_ms=${options.timeoutMs ?? "none"}`);
    if (runtimeOptions().log) {
      for (const host of destinations) {
        trackRuntimeTelemetry(lookupHost(host).then((dns) => {
          writeLog("PROCESS_DNS", `program=${program} host=${host} ips=${dns.ips.join(",") || "unavailable"} error=${dns.error ?? "none"}`);
        }));
      }
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;

    let finished = false;
    let timer: NodeJS.Timeout | undefined;
    const logResult = (result: string): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      writeLog("PROCESS", `program=${program} event=${result} duration_ms=${Date.now() - started} stdout_bytes=${Buffer.byteLength(stdout)} stderr_bytes=${Buffer.byteLength(stderr)}`);
    };
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        logResult("timeout");
        child.kill();
        reject(new Error(`Perintah melewati batas waktu ${options.timeoutMs} ms: ${command}`));
      }, options.timeoutMs);
    }

    const maxOutputBytes = options.maxOutputBytes ?? 10 * 1024 * 1024;
    const capture = (target: "stdout" | "stderr", chunk: Buffer): void => {
      if (finished) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) {
        logResult("output_limit");
        child.kill();
        reject(new Error(`Keluaran perintah melebihi batas ${maxOutputBytes} byte: ${program}`));
        return;
      }
      if (target === "stdout") stdout += chunk.toString();
      else stderr += chunk.toString();
    };
    child.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    child.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));

    child.on("error", (error) => {
      logResult(`spawn_error=${error.name}`);
      reject(error);
    });

    child.on("close", (code) => {
      logResult(`exit_code=${code ?? -1}`);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}
