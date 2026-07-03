import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VERSION_FILE = path.resolve(__dirname, "../src/lib/version.ts");
const GITHUB_REPO = "redmonkin/core-hr-hub";

async function fetchLatestVersion() {
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/tags`, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "hrms2-version-updater",
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub tag lookup failed with status ${response.status}`);
  }

  const tags = await response.json();
  const latestTag = Array.isArray(tags) ? tags[0]?.name : null;
  if (!latestTag) return null;

  const version = String(latestTag).replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version format "${version}" from tag "${latestTag}"`);
  }

  return { latestTag, version };
}

async function updateVersionFile(version) {
  const source = await readFile(VERSION_FILE, "utf8");
  const updated = source.replace(
    /export const APP_VERSION = "[^"]*"/,
    `export const APP_VERSION = "${version}"`,
  );

  if (updated === source) {
    console.log(`APP_VERSION already set to ${version}`);
    return;
  }

  await writeFile(VERSION_FILE, updated, "utf8");
  console.log(`Updated ${VERSION_FILE} to version ${version}`);
}

async function main() {
  try {
    console.log("Fetching latest tag from GitHub...");
    const result = await fetchLatestVersion();
    if (!result) {
      console.log("No tags found. Keeping existing APP_VERSION.");
      return;
    }

    console.log(`Using ${result.latestTag} -> ${result.version}`);
    await updateVersionFile(result.version);
  } catch (error) {
    console.warn(`Version update skipped: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await main();
