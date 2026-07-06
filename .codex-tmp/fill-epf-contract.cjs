const fs=require('fs');
const path=require('path');
const {PDFDocument, StandardFonts, rgb}=require('C:/Users/ADMIN/Desktop/Upgraded HRMS/HRMS2-link/backend/node_modules/pdf-lib');
const outDir='C:/Users/ADMIN/Downloads';
const sample={
  name:'SOFIYA SULTAN', code:'MAS47814', father:'SHIV SULTAN', dob:'01011995', mobile:'9876543210', email:'SOFIYA.SULTAN@TEAMMAS.CO.IN', uan:'123456789012', pan:'ABCDE1234F', aadhaar:'XXXX XXXX 1234', doj:'05072026', branch:'NOIDA', designation:'CUSTOMER SUPPORT EXECUTIVE', salary:'25000', date:'05', month:'JULY', year:'2026', fullDate:'05-07-2026'
};
function drawText(page,text,x,y,size=8){ page.drawText(String(text||''),{x,y,size,font:global.font,color:rgb(0,0,0)}); }
function drawChars(page,text,x,y,gap=15,size=7){ String(text||'').toUpperCase().slice(0,40).split('').forEach((ch,i)=>drawText(page,ch,x+i*gap,y,size)); }
function drawGrid(page,text,x,y,cellWidth,size=7){ const chars=String(text||'').toUpperCase().replace(/\s+/g,' ').trim().split(''); chars.forEach((ch,i)=>{ const w=global.font.widthOfTextAtSize(ch,size); drawText(page,ch,x+i*cellWidth+Math.max(0,(cellWidth-w)/2),y,size); }); }
function drawDigitGrid(page,text,x,y,cellWidth,size=7){ String(text||'').replace(/\D/g,'').split('').forEach((ch,i)=>{ const w=global.font.widthOfTextAtSize(ch,size); drawText(page,ch,x+i*cellWidth+Math.max(0,(cellWidth-w)/2),y,size); }); }
function tick(page,x,y){ drawText(page,'X',x,y,10); }
async function fillEpf(){
 const src='.codex-tmp/original-docs/EPF_Declaration_Form.pdf-1.pdf';
 const pdf=await PDFDocument.load(fs.readFileSync(src)); global.font=await pdf.embedFont(StandardFonts.HelveticaBold);
 const p1=pdf.getPage(0); drawGrid(p1,sample.name,170,550,16.75,6.5); drawDigitGrid(p1,sample.dob,187,500,22.9,6.5); drawGrid(p1,sample.father,170,434,16.75,6.5); tick(p1,245,373); tick(p1,214,313); drawDigitGrid(p1,sample.mobile,139,265,33.9,6.5); drawGrid(p1,sample.email,139,210,15.6,6); tick(p1,294,154); tick(p1,294,122);
 const p2=pdf.getPage(1); drawGrid(p2,sample.uan,201,715,26.2,6.5);
 const p3=pdf.getPage(2); drawText(p3,sample.name,244,717,6.5); drawText(p3,sample.aadhaar,365,717,6.5); drawText(p3,sample.name,244,693,6.5); drawText(p3,sample.pan,365,693,6.5); drawText(p3,sample.fullDate,90,394,7); drawText(p3,'NOIDA',90,377,7);
 fs.writeFileSync(path.join(outDir,'HRMS2-filled-EPF-declaration-sample.pdf'), await pdf.save());
}
async function fillContract(){
 const src='.codex-tmp/original-docs/Employment Contract-Mas (CF).pdf';
 const pdf=await PDFDocument.load(fs.readFileSync(src)); global.font=await pdf.embedFont(StandardFonts.HelveticaBold);
 const p1=pdf.getPage(0); drawText(p1,sample.date,428,736,7); drawText(p1,sample.month,111,722,7); drawText(p1,sample.year,184,722,7); drawText(p1,sample.name,90,560,6.5); drawText(p1,'D/O '+sample.father,265,560,6.5); drawText(p1,'NOIDA',495,560,6.5); drawText(p1,sample.designation,151,476,5.5); drawText(p1,sample.branch,241,453,6.5);
 const p7=pdf.getPage(6);  drawText(p7,'Mas Callnet India (P) Ltd',195,737,7); drawText(p7,sample.name,266,711,7); drawText(p7,sample.salary,317,538,7); drawText(p7,'Twenty Five Thousand',392,538,6.5); drawText(p7,sample.branch+' process',166,489,6.5);
 fs.writeFileSync(path.join(outDir,'HRMS2-filled-employment-contract-sample.pdf'), await pdf.save());
}
(async()=>{await fillEpf(); await fillContract(); console.log('done');})().catch(e=>{console.error(e);process.exit(1)})








