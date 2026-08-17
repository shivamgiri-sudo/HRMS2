const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "..", "src", "config", "routes");
const files = fs.readdirSync(routesDir).filter((f) => f.endsWith(".routes.tsx"));

const rows = [];
for (const file of files) {
  const module = file.replace(".routes.tsx", "");
  const content = fs.readFileSync(path.join(routesDir, file), "utf8");
  const routeRegex = /<Route\s+path="([^"]*)"([\s\S]*?)(?:\/>|<\/Route>)/g;
  let m;
  while ((m = routeRegex.exec(content))) {
    const routePath = m[1];
    const rest = m[2];
    const pageCodeMatch = rest.match(/pageCode="([^"]*)"/);
    const rolesMatch = rest.match(/roles=\{(\[[^\]]*\])\}/);
    const componentMatch = rest.match(/<(\w+)\s*\/?>(?:<\/\w+>)?\s*$/) || rest.match(/<(Native\w+|[A-Z]\w+)/g);
    rows.push({
      module,
      path: routePath,
      pageCode: pageCodeMatch ? pageCodeMatch[1] : "",
      rolesProp: rolesMatch ? rolesMatch[1].replace(/\s+/g, " ") : "",
    });
  }
}

// Dedup by path (some paths appear more than once across files by mistake or design)
const byPath = new Map();
for (const r of rows) {
  if (!byPath.has(r.path)) byPath.set(r.path, []);
  byPath.get(r.path).push(r);
}

const csvRows = [["module", "path", "pageCode", "rolesProp", "duplicateCount"]];
for (const [p, entries] of byPath) {
  const e = entries[0];
  csvRows.push([e.module, p, e.pageCode, e.rolesProp, String(entries.length)]);
}

const csv = csvRows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
fs.writeFileSync(path.join(__dirname, "..", "uat", "UAT_ROUTE_INVENTORY.csv"), csv);

console.log(`Total routes: ${rows.length}, distinct paths: ${byPath.size}`);
const dupes = [...byPath.entries()].filter(([, e]) => e.length > 1);
console.log(`Duplicate path registrations: ${dupes.length}`);
for (const [p, e] of dupes.slice(0, 20)) {
  console.log(`  ${p} -> ${e.map((x) => x.module).join(", ")}`);
}
