const fs=require('fs'),path=require('path');
const ROOT='C:/Users/ADMIN/Desktop/HRMS2-latest';
const env=Object.fromEntries(fs.readFileSync(path.join(ROOT,'backend/.env'),'utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const mysql=require(path.join(ROOT,'backend/node_modules/mysql2/promise'));
const MONTH=process.argv[2]||'2026-07';
const n=v=>{const x=parseFloat(String(v??'').replace(/,/g,''));return isNaN(x)?0:x;};
(async()=>{
  const h=await mysql.createConnection({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
  const b=await mysql.createConnection({host:env.BILL_DB_HOST,port:+env.BILL_DB_PORT,user:env.BILL_DB_USER,password:env.BILL_DB_PASSWORD,database:env.BILL_DB_NAME});
  const [hr]=await h.query(
    `SELECT e.employee_code ec, l.gross_salary g, l.total_deductions d, l.net_salary net
       FROM salary_prep_line l JOIN salary_prep_run r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
      WHERE r.run_month=?`,[MONTH]);
  const [bl]=await b.query(
    `SELECT EmpCode ec, Gross g, Gross1 g1, TotalDeduction td, NetSalary net, ESIC, EPF, IncomeTax it,
            ProTaxDeduction pt, AdvPaid adv, LoanDed loan, LeaveDeduction ld, OtherDeduction od,
            MobileDedcution mob, ShortCollection sc, AssetRecovery ar, Insurance ins, SHSH,
            Incentive inc, ExtraDayIncentive edi, Arrear arr, PLI
       FROM salary_data WHERE SalDate LIKE ?`,[MONTH+'%']);
  const B=new Map(bl.map(r=>[String(r.ec||'').trim(),r]));
  let dedFormula=0,netFromG1=0,m=0,gEq=0,g1Eq=0,netEq=0,dEq=0,idOk=0,idBad=0,gapSum=0;
  const bad=[],netBad=[];
  for(const r of hr){
    const s=B.get(String(r.ec||'').trim()); if(!s) continue; m++;
    if(Math.abs(n(r.g)-n(s.g))<=0.5) gEq++;
    if(Math.abs(n(r.g)-n(s.g1))<=0.5) g1Eq++;
    if(Math.abs(n(r.net)-n(s.net))<=0.5) netEq++;
    if(Math.abs(n(r.d)-n(s.td))<=0.5) dEq++;
    // legacy identity: Net = Gross1 + additions - all deductions
    // TotalDeduction is the ROLL-UP of the non-statutory buckets (ProTax, Leave, Other,
    // Mobile, ShortCollection, AssetRecovery, Insurance, SHSH) - do not add those twice.
    const ded=n(s.ESIC)+n(s.EPF)+n(s.it)+n(s.adv)+n(s.loan)+n(s.td);
    const add=n(s.inc)+n(s.edi)+n(s.arr)+n(s.PLI);
    const calc=n(s.g1)+add-ded;
    if(Math.abs(calc-n(s.net))<=1.5) idOk++; else {idBad++; if(bad.length<5) bad.push({ec:r.ec,g1:s.g1,add,ded,calc,net:s.net});}
    gapSum+=Math.abs(n(r.g)-n(r.net)-n(r.d));
    // does HRMS total_deductions equal the statutory+recovery sum?
    const hrDedExpect=n(s.ESIC)+n(s.EPF)+n(s.it)+n(s.adv)+n(s.loan)+n(s.td);
    if(Math.abs(n(r.d)-hrDedExpect)<=0.5) dedFormula++;
    if(Math.abs(n(s.g1)+add-ded-n(r.net))<=1.5) netFromG1++;
    else if(netBad.length<8) netBad.push({ec:r.ec,billNet:s.net,hrNet:r.net,g1:s.g1,g:s.g,add,ded,delta:+(n(r.net)-n(s.net)).toFixed(2)});
  }
  console.log(JSON.stringify({MONTH,hrLines:hr.length,billRows:bl.length,matched:m,
    hrGross_eq_billGross:gEq, hrGross_eq_billGross1:g1Eq, hrNet_eq_billNet:netEq, hrDed_eq_billTotalDeduction:dEq, hrDed_eq_statutorySum:dedFormula, hrNet_eq_G1formula:netFromG1,
    legacyIdentityHolds:idOk, legacyIdentityFails:idBad, hrmsAbsGapSum:Math.round(gapSum)},null,1));
  console.log('identity failures sample:',JSON.stringify(bad,null,1));
  console.log('HRMS net != bill net sample:',JSON.stringify(netBad,null,1));
  await h.end();await b.end();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
