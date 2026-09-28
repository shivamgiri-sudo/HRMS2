import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VERSION_FILE = path.resolve(__dirname, "../src/lib/version.ts");

function getLocalVersion() {
  try {
    const raw = execSync("git describe --tags --always --dirty=-dev", { encoding: "utf8" }).trim();
    return raw.replace(/^v/, "");
  } catch {
    return `0.0.0-build-${new Date().toISOString().slice(0, 10)}`;
  }
}

async function updateVersionFile(version) {
  const source = await readFile(VERSION_FILE, "utf8");
  const updated = source.replace(
    /export const APP_VERSION = "[^"]*"/,
    `export const APP_VERSION = "${version}"`
  );
  if (updated === source) {
    console.log(`APP_VERSION already set to ${version}`);
    return;
  }
  await writeFile(VERSION_FILE, updated, "utf8");
  console.log(`Updated ${VERSION_FILE} to version ${version}`);
}

const version = getLocalVersion();
console.log(`Local version: ${version}`);
await updateVersionFile(version);
