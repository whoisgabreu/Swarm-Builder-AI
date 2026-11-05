import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export type OpencodeServer = {
  url: string;
  reused: boolean;
  close(): void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const health = async (url: string): Promise<boolean> => {
  try {
    const response = await fetch(`${url}/global/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const body = (await response.json()) as { healthy?: boolean };
    return body.healthy === true;
  } catch {
    return false;
  }
};

export const startOpencodeServer = async (options: {
  runtimeDir: string;
  port?: number;
  hostname?: string;
  timeoutMs?: number;
  reuse?: boolean;
}): Promise<OpencodeServer> => {
  const runtimeDir = resolve(options.runtimeDir);
  if (!existsSync(runtimeDir)) throw new Error(`opencode runtime dir not found: ${runtimeDir}`);
  const port = options.port ?? Number(process.env.SWARM_OPENCODE_PORT ?? 4097);
  const hostname = options.hostname ?? "127.0.0.1";
  const url = `http://${hostname}:${port}`;
  const timeoutMs = options.timeoutMs ?? 20000;
  const reuse = options.reuse ?? true;

  if (reuse && (await health(url))) return { url, reused: true, close() {} };

  const binary = process.env.OPENCODE_BIN ?? "opencode";
  const env = { ...process.env, OPENCODE_CONFIG_CONTENT: undefined };
  const proc: ChildProcessWithoutNullStreams = spawn(
    binary,
    ["serve", "--pure", `--hostname=${hostname}`, `--port=${port}`],
    { cwd: runtimeDir, env },
  );

  let output = "";
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    proc.kill();
  };

  await new Promise<void>((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      close();
      reject(new Error(`timeout waiting for opencode server after ${timeoutMs}ms\n${output.slice(-2000)}`));
    }, timeoutMs);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (/opencode server listening/i.test(output)) {
        clearTimeout(timer);
        resolvePromise();
      }
    };

    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`opencode server exited with ${code}\n${output.slice(-2000)}`));
    });
  });

  for (let i = 0; i < 20; i++) {
    if (await health(url)) break;
    await sleep(150);
  }
  if (!(await health(url))) {
    close();
    throw new Error(`opencode server did not become healthy at ${url}`);
  }

  return { url, reused: false, close };
};
