const mysql = require("mysql2/promise");
const { v4: uuidv4 } = require("uuid");

async function main() {
  const src = await mysql.createConnection({
    host: "14.97.30.236",
    port: 3306,
    user: "shivam_user",
    password: "qwersdfg!@#hjk",
    database: "db_bill",
    connectTimeout: 15000,
  });
  const dst = await mysql.createConnection({
    host: "122.184.128.90",
    port: 3306,
    user: "shivam_user",
    password: "qwersdfg!@#hjk",
    database: "mas_hrms",
    connectTimeout: 30000,
  });

  try {
    const [existingRows] = await dst.query(
      "SELECT DISTINCT grn_request_id FROM vendor_payment_transaction WHERE grn_request_id IS NOT NULL",
    );
    const existingGrnIds = new Set(existingRows.map((r) => r.grn_request_id));
    console.log("Existing VPT GRN IDs:", existingGrnIds.size);

    const [grnMapRows] = await dst.query(
      "SELECT id, grn_number FROM grn_request WHERE grn_number IS NOT NULL",
    );
    const grnNumToId = {};
    for (const g of grnMapRows) grnNumToId[g.grn_number] = g.id;
    console.log("GRN map entries:", Object.keys(grnNumToId).length);

    const [payments] = await src.query(
      "SELECT Id,GrnNo,DueAmount,PaymentDate,TransactionId,BankName,CreateDate FROM tbl_payment_processing WHERE GrnNo IS NOT NULL AND DueAmount > 0 ORDER BY CreateDate",
    );
    console.log("tbl_payment_processing rows:", payments.length);

    const toInsert = [];
    for (const p of payments) {
      const grnId = grnNumToId[p.GrnNo];
      if (!grnId || existingGrnIds.has(grnId)) continue;
      toInsert.push([
        uuidv4(),
        grnId,
        parseFloat(p.DueAmount) || 0,
        p.PaymentDate ? new Date(p.PaymentDate) : new Date(p.CreateDate),
        p.TransactionId || null,
        p.BankName || null,
        new Date(p.CreateDate),
      ]);
    }
    console.log("Missing payments to insert:", toInsert.length);

    if (toInsert.length > 0) {
      const chunkSize = 500;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        await dst.query(
          "INSERT INTO vendor_payment_transaction (id,grn_request_id,amount,payment_date,transaction_id,bank_name,created_at) VALUES ?",
          [toInsert.slice(i, i + chunkSize)],
        );
        process.stdout.write(".");
      }
      console.log("\nInserted:", toInsert.length);
    }

    const [cnt] = await dst.query(
      "SELECT COUNT(*) cnt FROM vendor_payment_transaction",
    );
    console.log("Total vendor_payment_transaction rows:", cnt[0].cnt);
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((e) => {
  console.error("ERR:", e.message);
  process.exit(1);
});
