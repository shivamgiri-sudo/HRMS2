const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Mapping from the image: Employee Code -> Official Email ID
const emailMappings = [
  { employeeCode: 'MAS38040', email: 'Prem.ragput@teammas.in' },
  { employeeCode: 'MAS51531', email: 'Bhavesh.dayal@teammas.in' },
  { employeeCode: 'MAS57432', email: 'rahul.ragat1@teammas.co.in' },
  { employeeCode: 'MAS59584', email: 'javed.khanregreg@teammas.co.in' },
  { employeeCode: 'MAS59586', email: 'raishinberg@teammas.co.in' },
  { employeeCode: 'MAS59593', email: 'jabeen.shakreg@teammas.co.in' },
  { employeeCode: 'MAS59596', email: 'saurabh.yadavreg@teammas.co.in' },
  { employeeCode: 'MAS59598', email: 'hassanmuaaz.husseinreg@teammas.co.in' },
  { employeeCode: 'MAS59610', email: 'sonureg@teammas.co.in' },
  { employeeCode: 'MAS59726', email: 'gireeshreg@teammas.co.in' },
  { employeeCode: 'MAS60037', email: 'sitaramreg@teammas.co.in' },
  { employeeCode: 'MAS60040', email: 'kundan.kashyap@teammas.co.in' },
  { employeeCode: 'MAS61106', email: 'tusharreg@teammas.co.in' },
  { employeeCode: 'MAS60244', email: 'gontasetti.venkatesh@teammas.co.in' },
  { employeeCode: 'MAS60390', email: 'ajay.singh52@teammas.co.in' },
  { employeeCode: 'MAS60549', email: 'ajeethreg@teammas.co.in' },
  { employeeCode: 'MAS60618', email: 'shashank@teammas.co.in' },
  { employeeCode: 'MAS60636', email: 'kishan.yadavagt@teammas.co.in' },
  { employeeCode: 'MAS60804', email: 'kavitha.ganereg@teammas.co.in' },
  { employeeCode: 'MAS60806', email: 'nithya.mregreg@teammas.co.in' },
  { employeeCode: 'MAS60856', email: 'chintan.vimareg@teammas.co.in' },
  { employeeCode: 'MAS60858', email: 'deepak.madhureg@teammas.co.in' },
  { employeeCode: 'MAS60859', email: 'preetiseemag@teammas.co.in' },
  { employeeCode: 'MAS60897', email: 'lavenjeshreg@teammas.co.in' },
  { employeeCode: 'MAS61049', email: 'ram.mirchoreg@teammas.co.in' },
  { employeeCode: 'MAS61183', email: 'nandyala.ankalinreg@teammas.co.in' },
  { employeeCode: 'MAS61289', email: 'roshan.charureg@teammas.co.in' },
  { employeeCode: 'MAS61295', email: 'sayyedarajreg@teammas.co.in' },
  { employeeCode: 'MAS61342', email: 'jaishankarhreg@teammas.co.in' },
  { employeeCode: 'MAS61344', email: 'naeem.saifio3g@teammas.co.in' },
  { employeeCode: 'MAS61346', email: 'sajjadhreg@teammas.co.in' },
  { employeeCode: 'MAS61383', email: 'rishashank.reddyreg@teammas.co.in' },
  { employeeCode: 'MAS61416', email: 'dey@teammas.co.in' },
  { employeeCode: 'MAS61459', email: 'gunjun.gunareg@teammas.co.in' },
  { employeeCode: 'MAS61463', email: 'emon.miahreg@teammas.co.in' },
  { employeeCode: 'MAS61488', email: 'akanksha.virhatreg@teammas.co.in' },
  { employeeCode: 'MAS61491', email: 'vivek.reg@teammas.co.in' },
  { employeeCode: 'MAS61464', email: 'tanisha.yadavreg@teammas.co.in' },
  { employeeCode: 'MAS61500', email: 'parth@teammas.co.in' },
  { employeeCode: 'MAS61522', email: 'jihin.jimmyreg@teammas.co.in' },
  { employeeCode: 'MAS61621', email: 'sudheesh.devio3@teammas.co.in' },
  { employeeCode: 'MAS61778', email: 'manisha.yadavagt@teammas.co.in' },
  { employeeCode: 'MAS61929', email: 'poonamreg@teammas.co.in' },
  { employeeCode: 'MAS62007', email: 'kilsparthasayan.naidureg@teammas.co.in' },
  { employeeCode: 'MAS62008', email: 'rabeea.kumartcreg@teammas.co.in' },
  { employeeCode: 'MAS62043', email: 'ajit.kumar@teammas.in' },
  { employeeCode: 'MAS62045', email: 'ranjoor.singhorgt@teammas.co.in' },
  { employeeCode: 'MAS62053', email: 'shivam.vishwakarmareg@teammas.co.in' },
  { employeeCode: 'MAS62054', email: 'bhavesh.mandreg@teammas.co.in' },
  { employeeCode: 'MAS62180', email: 'shilpa.krishnareg@teammas.co.in' },
  { employeeCode: 'MAS62185', email: 'bhupendra.sinreg@teammas.co.in' },
  { employeeCode: 'MAS62196', email: 'arman.khanfin@teammas.co.in' },
  { employeeCode: 'MAS62197', email: 'aman.khanfin@teammas.co.in' },
  { employeeCode: 'MAS62198', email: 'abhinav.shukafin@teammas.co.in' },
  { employeeCode: 'MAS62199', email: 'raiyahkumarfin@teammas.co.in' },
  { employeeCode: 'MAS62257', email: 'Kaushal.kanojafin@teammas.co.in' },
  { employeeCode: 'MAS62259', email: 'Sourabh.kumarfin@teammas.co.in' },
  { employeeCode: 'MAS62260', email: 'Muhammad.aressfin@teammas.co.in' },
  { employeeCode: 'MAS62261', email: 'Chandan.gurfinreg@teammas.co.in' },
  { employeeCode: 'MAS62262', email: 'Arish.fin@teammas.co.in' },
  { employeeCode: 'MAS62263', email: 'Rachit.kumarfin@teammas.co.in' },
  { employeeCode: 'MAS62264', email: 'Dheeraj.kumarfin@teammas.co.in' },
  { employeeCode: 'MAS62285', email: 'karti.kumarfin@teammas.co.in' },
  { employeeCode: 'MAS62323', email: 'angel.gracefinreg@teammas.co.in' },
  { employeeCode: 'MAS62324', email: 'harsh.kumaridreg@teammas.co.in' },
  { employeeCode: 'MAS62353', email: 'madhur.jaiswaib3@teammas.co.in' },
  { employeeCode: 'MAS62357', email: 'ashotooh.palhreg@teammas.co.in' },
  { employeeCode: 'MAS62358', email: 'mukta.singhfin@teammas.co.in' },
  { employeeCode: 'MAS62359', email: 'abhishek.sufin@teammas.co.in' },
  { employeeCode: 'MAS62360', email: 'sumit.rawatfin@teammas.co.in' },
  { employeeCode: 'MAS62361', email: 'pragyafin@teammas.co.in' },
  { employeeCode: 'MAS62363', email: 'sahil.singhfin@teammas.co.in' },
  { employeeCode: 'MAS62364', email: 'shivam.vermatc@teammas.co.in' },
  { employeeCode: 'MAS62366', email: 'love.aryafin@teammas.co.in' },
  { employeeCode: 'MAS62367', email: 'harsh.vashisthreg@teammas.co.in' },
  { employeeCode: 'MAS62368', email: 'ahsarfin@teammas.co.in' },
  { employeeCode: 'MAS62369', email: 'hasel.mirreg@teammas.co.in' },
  { employeeCode: 'MAS62413', email: 'anusonareg@teammas.co.in' },
  { employeeCode: 'MAS62415', email: 'rina.dabreg@teammas.co.in' },
  { employeeCode: 'MAS62466', email: 'aman.nayaktinreg@teammas.co.in' },
  { employeeCode: 'MAS62467', email: 'sayan.naiktinreg@teammas.co.in' },
  { employeeCode: 'MAS62468', email: 'ankush.kumartinreg@teammas.co.in' },
  { employeeCode: 'MAS62469', email: 'beilamkonda.venkatanareg@teammas.co.in' },
  { employeeCode: 'MAS62510', email: 's.kanchanadreg@teammas.co.in' },
  { employeeCode: 'MAS62533', email: 'sunilhreg@teammas.co.in' },
  { employeeCode: 'MAS62573', email: 'tejas.anandndreg@teammas.co.in' },
  { employeeCode: 'MAS62574', email: 'roy.blushartreg@teammas.co.in' },
  { employeeCode: 'MAS62575', email: 'araveet.malikfin@teammas.co.in' },
  { employeeCode: 'MAS62648', email: 'shikha.mathurb3@teammas.co.in' },
  { employeeCode: 'MAS62707', email: 'angel.sharmaio3@teammas.co.in' },
  { employeeCode: 'MAS62775', email: 'nicstefin@teammas.co.in' },
  { employeeCode: 'MAS62777', email: 'sajiavbg@teammas.co.in' },
  { employeeCode: 'MAS62778', email: 'bajal.yoghb3@teammas.co.in' },
  { employeeCode: 'MAS62779', email: 'Shilpa.shahb3@teammas.co.in' },
  { employeeCode: 'MAS62846', email: 'vishalkumartm@teammas.co.in' },
  { employeeCode: 'MAS62847', email: 'narendra.shrtm@teammas.co.in' },
  { employeeCode: 'MAS62848', email: 'Abhishek.singhtm@teammas.co.in' },
  { employeeCode: 'MAS62849', email: 'shilpa.kumartm@teammas.co.in' },
  { employeeCode: 'MAS62850', email: 'chandan.singhtm@teammas.co.in' },
  { employeeCode: 'MAS62852', email: 'abhishek.rathortm@teammas.co.in' },
  { employeeCode: 'MAS62853', email: 'sachindir@teammas.co.in' },
  { employeeCode: 'MAS62851', email: 'dharmendra.kumar@teammas.co.in' },
  { employeeCode: 'MAS47827', email: 'anup.kumar@teammas.co.in' },
  { employeeCode: 'MAS62854', email: 'sheikh.vermareg@teammas.co.in' },
  { employeeCode: 'MAS48548', email: 'prateek.saraswat@teammas.co.in' },
  { employeeCode: 'MAS54280', email: 'nikhil.kumar@teammas.co.in' },
  { employeeCode: 'MAS57637', email: 'ravi.p@teammas.co.in' },
  { employeeCode: 'MAS61349', email: 'dipeshreg@teammas.co.in' },
  { employeeCode: 'MAS61660', email: 'srashti.chauhan@teammas.co.in' },
  { employeeCode: 'MAS62325', email: 'farzeena.co.in' },
  { employeeCode: 'MAS62457', email: 'sofiya.sultan@teammas.co.in' },
  { employeeCode: 'MAS62458', email: 'adil.singhorgt@teammas.co.in' },
];

async function updateEmails() {
  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  });

  try {
    console.log(`Starting update of ${emailMappings.length} official email addresses...\n`);

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const mapping of emailMappings) {
      try {
        // Update official_email where employee_code matches
        const [result] = await connection.execute(
          'UPDATE employees SET official_email = ? WHERE employee_code = ?',
          [mapping.email, mapping.employeeCode]
        );

        if (result.affectedRows === 0) {
          errors.push(`Employee ${mapping.employeeCode} not found`);
          errorCount++;
        } else {
          successCount++;
          console.log(`✅ ${mapping.employeeCode} → ${mapping.email}`);
        }

      } catch (err) {
        errors.push(`${mapping.employeeCode}: ${err.message}`);
        errorCount++;
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`❌ Errors: ${errorCount}`);

    if (errors.length > 0) {
      console.log(`\nErrors:`);
      errors.forEach(err => console.log(`  - ${err}`));
    }

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

updateEmails();
