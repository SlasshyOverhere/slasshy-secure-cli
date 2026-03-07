import { spawnSync } from "node:child_process";
import { chmod, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const desktopRoot = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(desktopRoot, "..");
const runtimeRoot = path.join(desktopRoot, ".backend-runtime");
const bundledNodeDir = path.join(runtimeRoot, "node");
const bundledNodeName = process.platform === "win32" ? "node.exe" : path.basename(process.execPath);

async function copyBackendRuntime() {
  await rm(runtimeRoot, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
  await mkdir(runtimeRoot, { recursive: true });

  await cp(path.join(repoRoot, "dist"), path.join(runtimeRoot, "dist"), {
    recursive: true,
    force: true,
  });
  await cp(path.join(repoRoot, "package.json"), path.join(runtimeRoot, "package.json"), {
    force: true,
  });
  await cp(
    path.join(repoRoot, "package-lock.json"),
    path.join(runtimeRoot, "package-lock.json"),
    { force: true },
  );

  await mkdir(path.join(runtimeRoot, "assets"), { recursive: true });
  await cp(
    path.join(repoRoot, "assets", "blankdrive-logo.png"),
    path.join(runtimeRoot, "assets", "blankdrive-logo.png"),
    { force: true },
  );

  await mkdir(bundledNodeDir, { recursive: true });
  const bundledNodePath = path.join(bundledNodeDir, bundledNodeName);
  await cp(process.execPath, bundledNodePath, { force: true });
  if (process.platform !== "win32") {
    await chmod(bundledNodePath, 0o755);
  }
}

function installProductionDependencies() {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "npm ci --omit=dev"], {
          cwd: runtimeRoot,
          stdio: "inherit",
          windowsHide: true,
        })
      : spawnSync("npm", ["ci", "--omit=dev"], {
          cwd: runtimeRoot,
          stdio: "inherit",
          windowsHide: true,
        });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`npm ci --omit=dev failed with exit code ${result.status ?? "unknown"}.`);
  }
}

async function main() {
  await copyBackendRuntime();
  installProductionDependencies();
}

main().catch((error) => {
  console.error("Failed to prepare desktop backend runtime.");
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
