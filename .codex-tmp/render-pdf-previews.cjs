const fs=require('fs');
const path=require('path');
const {PDFParse}=require('C:/Users/ADMIN/Desktop/Upgraded HRMS/HRMS2-link/backend/node_modules/pdf-parse');
(async()=>{
  const outDir='.codex-tmp/pdf-previews'; fs.mkdirSync(outDir,{recursive:true});
  for(const file of ['EPF_Declaration_Form.pdf-1.pdf','Employment Contract-Mas (CF).pdf']){
    const parser=new PDFParse({data:fs.readFileSync('.codex-tmp/original-docs/'+file)});
    await parser.load();
    const shot=await parser.getScreenshot({scale:1});
    for(const page of shot.pages){
      const name=path.join(outDir, file.replace(/[^a-z0-9]+/gi,'-')+'-p'+page.pageNumber+'.png');
      fs.writeFileSync(name, Buffer.from(page.data));
      console.log(name, page.width, page.height);
    }
    await parser.destroy();
  }
})().catch(e=>{console.error(e);process.exit(1)})
