import XLSX from "xlsx";

const file = "C:/Users/MAS60358/Desktop/Clovia/Owner/Housing Owner Sep'26 Sale (1).xlsx";
const wb = XLSX.readFile(file, { cellStyles: false, cellFormula: false });

function dump(name, maxRows = 60, maxCols = 30) {
  const sheet = wb.Sheets[name];
  if (!sheet) { console.log("no sheet", name); return; }
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  console.log(`\n===== ${name} (${rows.length} non-blank rows) =====`);
  for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
    const row = rows[i].slice(0, maxCols);
    if (row.some((c) => String(c).trim() !== "")) console.log(i, JSON.stringify(row));
  }
}

dump("Top 5 Bottom 5", 20, 15);
dump("Status", 10, 5);
dump("Agent Wise Performance", 15, 25);
