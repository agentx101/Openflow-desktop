import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUSTUP_INIT_URL = "https://win.rustup.rs/x86_64";

function cargoBinDir() {
  return path.join(os.homedir(), ".cargo", "bin");
}

function cargoBinaryPath() {
  return path.join(cargoBinDir(), process.platform === "win32" ? "cargo.exe" : "cargo");
}

function prependToPath(dirPath) {
  const current = process.env.PATH || "";
  const parts = current.split(path.delimiter).filter(Boolean);
  if (!parts.includes(dirPath)) {
    process.env.PATH = [dirPath, ...parts].join(path.delimiter);
  }
}

function verifyCargo(binaryPath) {
  execFileSync(binaryPath, ["--version"], { stdio: "pipe" });
}

async function downloadFile(url, destinationPath) {
  if (typeof fetch === "function") {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to download Rust installer: HTTP ${res.status}`);
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    await fs.writeFile(destinationPath, buffer);
    return;
  }

  throw new Error("This Node runtime does not support fetch for downloading Rust installer.");
}

function isDirectExecution() {
  const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
  const modulePath = fileURLToPath(import.meta.url);
  return invokedPath === modulePath;
}

export async function ensureRust() {
  const cargoDir = cargoBinDir();
  const cargoPath = cargoBinaryPath();

  if (existsSync(cargoPath)) {
    prependToPath(cargoDir);
    verifyCargo(cargoPath);
    return cargoDir;
  }

  if (process.platform !== "win32") {
    const result = spawnSync("sh", [path.join("scripts", "ensure-rust.sh")], {
      stdio: "inherit",
      shell: false,
      env: process.env
    });
    if (result.status !== 0) {
      throw new Error("Rust bootstrap failed. Install Rust/Cargo manually and rerun the command.");
    }
    if (existsSync(cargoPath)) {
      prependToPath(cargoDir);
      verifyCargo(cargoPath);
      return cargoDir;
    }
    throw new Error("Rust bootstrap completed but cargo is still unavailable.");
  }

  const installDir = path.join(os.tmpdir(), "openflow-rustup");
  await fs.mkdir(installDir, { recursive: true });
  const installerPath = path.join(installDir, "rustup-init.exe");
  if (!existsSync(installerPath)) {
    console.log("[setup:rust] Downloading Rust installer...");
    await downloadFile(RUSTUP_INIT_URL, installerPath);
  }

  console.log("[setup:rust] Installing Rust toolchain...");
  const installResult = spawnSync(installerPath, ["-y", "--profile", "default", "--default-toolchain", "stable"], {
    stdio: "inherit",
    shell: false,
    env: process.env
  });
  if (installResult.status !== 0) {
    throw new Error("Rust installation failed. Install Rust/Cargo manually and rerun the command.");
  }

  prependToPath(cargoDir);
  if (!existsSync(cargoPath)) {
    throw new Error("Rust installed, but cargo.exe was not found in ~/.cargo/bin.");
  }
  verifyCargo(cargoPath);
  return cargoDir;
}

if (isDirectExecution()) {
  ensureRust()
    .then(() => {
      console.log("[setup:rust] Rust ready");
    })
    .catch((error) => {
      console.error(`[setup:rust] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}