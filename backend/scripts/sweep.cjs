const fs=require('fs'),path=require('path');
const ROOT='C:/Users/ADMIN/Desktop/HRMS2-latest';
const env=Object.fromEntries(fs.readFileSync(path.join(ROOT,'backend/.env'),'utf8').split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim().replace(/^["']|["']$/g,'')]));
const mysql=require(path.join(ROOT,'backend/node_modules/mysql2/promise'));
const n=v=>{const x=parseFloat(String(v??'').replace(/,/g,''));return isNaN(x)?0:x;};
(async()=>{
  const h=await mysql.createConnection({host:env.DB_HOST,port:+env.DB_PORT,user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
  const b=await mysql.createConnection({host:env.BILL_DB_HOST,port:+env.BILL_DB_PORT,user:env.BILL_DB_USER,password:env.BILL_DB_PASSWORD,database:env.BILL_DB_NAME});
  const [months]=await h.query("SELECT DISTINCT run_month m FROM salary_prep_run ORDER BY m");
  const T={lines:0,matched:0,unmatched:0,grossIsEntitlement:0,netOk:0,netWrong:0,overstate:0,understate:0,netWrongAmt:0,grossGap:0};
  const worst=[],byMonth={};
  for(const {m} of months){
    const [hr]=await h.query(
      `SELECT e.employee_code ec,l.gross_salary g,l.total_deductions d,l.net_salary net
         FROM salary_prep_line l JOIN salary_prep_run r ON r.id=l.run_id JOIN employees e ON e.id=l.employee_id
        WHERE r.run_month=?`,[m]);
    if(!hr.length) continue;
    const [bl]=await b.query(
      `SELECT EmpCode ec,Gross g,Gross1 g1,TotalDeduction td,NetSalary net,ESIC,EPF,IncomeTax it,
              AdvPaid adv,LoanDed loan,Incentive inc,ExtraDayIncentive edi,Arrear arr,PLI
         FROM salary_data WHERE SalDate LIKE ?`,[m+'%']);
    const B=new Map(bl.map(r=>[String(r.ec||'').trim(),r]));
    for(const r of hr){
      T.lines++;
      const s=B.get(String(r.ec||'').trim());
      if(!s){T.unmatched++;continue;}
      T.matched++;
      if(Math.abs(n(r.g)-n(s.g))<=0.5) T.grossIsEntitlement++;
      T.grossGap+=Math.abs(n(s.g)-n(s.g1));
      const delta=n(r.net)-n(s.net);
      if(Math.abs(delta)<=1.5) T.netOk++;
      else{
        T.netWrong++; T.netWrongAmt+=Math.abs(delta);
        if(delta>0) T.overstate++; else T.understate++;
        byMonth[m]=byMonth[m]||{n:0,amt:0}; byMonth[m].n++; byMonth[m].amt+=Math.abs(delta);
        if(worst.length<5||Math.abs(delta)>worst[worst.length-1].delta){
          worst.push({m,ec:r.ec,billNet:n(s.net),hrNet:n(r.net),billG1:n(s.g1),billG:n(s.g),delta:+delta.toFixed(2)});
          worst.sort((a,c)=>Math.abs(c.delta)-Math.abs(a.delta)); worst.length=Math.min(worst.length,5);
        }
      }
    }
  }
  T.netWrongAmt=Math.round(T.netWrongAmt); T.grossGap=Math.round(T.grossGap);
  console.log(JSON.stringify(T,null,1));
  console.log('net-wrong by month:',JSON.stringify(byMonth,null,1));
  console.log('worst net divergences:',JSON.stringify(worst,null,1));
  await h.end();await b.end();
})().catch(e=>{console.error('FATAL',e.message);process.exit(1)});
