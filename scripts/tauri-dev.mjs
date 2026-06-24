import { spawn } from "node:child_process";
import path from "node:path";
import { ensureRust } from "./ensure-rust.mjs";

function tauriBinaryPath() {
  return path.join(process.cwd(), "node_modules", "@tauri-apps", "cli", "tauri.js");
}

async function main() {
  const cargoDir = await ensureRust();
  const env = {
    ...process.env,
    PATH: [cargoDir, process.env.PATH || ""].filter(Boolean).join(path.delimiter)
  };

  const child = spawn(process.execPath, [tauriBinaryPath(), "dev"], {
    stdio: "inherit",
    env,
    shell: false
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });

  child.on("error", (error) => {
    console.error(`[tauri:dev] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

void main();
