import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const ROUTES_DIR = resolve(ROOT, "src/config/routes");

function extractRoutes(filePath) {
  const content = readFileSync(filePath, "utf8");
  const routes = [];
  const relPath = filePath.replace(ROOT + "\\", "").replace(ROOT + "/", "");

  // Match: path="..." element={<ComponentName
  const routeRegex = /path=["']([^"']+)["'][^>]*element=\{[^}]*?(\w+)\s*[/\s>]/g;
  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    if (match[2] !== "Navigate" && match[2] !== "Redirect" && match[2] !== "ProtectedRoute") {
      routes.push({ path: match[1], component: match[2], file: relPath, isRedirect: false });
    }
  }

  // Match Navigate redirects
  const redirectRegex = /path=["']([^"']+)["'][^>]*Navigate[^>]*to=["']([^"']+)["']/g;
  while ((match = redirectRegex.exec(content)) !== null) {
    routes.push({ path: match[1], component: `→ ${match[2]}`, file: relPath, isRedirect: true });
  }

  return routes;
}

const routeFiles = readdirSync(ROUTES_DIR)
  .filter(f => f.endsWith(".tsx") || f.endsWith(".ts"))
  .map(f => resolve(ROUTES_DIR, f));

const allRoutes = routeFiles.flatMap(extractRoutes);
const canonicalRoutes = allRoutes.filter(r => !r.isRedirect);
const redirects = allRoutes.filter(r => r.isRedirect);

// Group by component to find duplicates
const byComponent = {};
for (const r of canonicalRoutes) {
  byComponent[r.component] = byComponent[r.component] || [];
  byComponent[r.component].push(r);
}

const duplicates = Object.entries(byComponent).filter(([, routes]) => routes.length > 1);
const unique = Object.entries(byComponent).filter(([, routes]) => routes.length === 1);

let report = `# Route Inventory Report\n\nGenerated: ${new Date().toISOString()}\n\n`;
report += `**Total route declarations:** ${allRoutes.length}\n`;
report += `**Unique component names:** ${Object.keys(byComponent).length}\n`;
report += `**Redirects (Navigate):** ${redirects.length}\n`;
report += `**Components with multiple paths (duplicates):** ${duplicates.length}\n\n`;

report += `## Duplicates — Components Registered Under Multiple Paths\n\n`;
if (duplicates.length === 0) {
  report += `_No duplicates found._\n\n`;
} else {
  report += `| Component | Paths | Files |\n|-----------|-------|-------|\n`;
  for (const [component, routes] of duplicates.sort((a, b) => a[0].localeCompare(b[0]))) {
    const paths = routes.map(r => `\`${r.path}\``).join(", ");
    const files = [...new Set(routes.map(r => r.file))].join(", ");
    report += `| ${component} | ${paths} | ${files} |\n`;
  }
}

report += `\n## Redirects\n\n`;
if (redirects.length === 0) {
  report += `_No redirects found._\n\n`;
} else {
  report += `| From | To | File |\n|------|-----|------|\n`;
  for (const r of redirects) {
    report += `| \`${r.path}\` | ${r.component} | ${r.file} |\n`;
  }
}

report += `\n## All Canonical Routes\n\n`;
report += `| Component | Path | File |\n|-----------|------|------|\n`;
for (const [component, routes] of [...unique, ...duplicates].sort((a, b) => a[0].localeCompare(b[0]))) {
  for (const route of routes) {
    const dupMark = routes.length > 1 ? " ⚠️" : "";
    report += `| ${component}${dupMark} | \`${route.path}\` | ${route.file} |\n`;
  }
}

const outputPath = resolve(ROOT, "docs/route-inventory.md");
writeFileSync(outputPath, report, "utf8");
console.log(`Report written to docs/route-inventory.md`);
console.log(`Total: ${allRoutes.length} routes, ${Object.keys(byComponent).length} unique components, ${duplicates.length} with duplicates`);
