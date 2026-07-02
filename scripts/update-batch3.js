const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Employee Code, Manager Code, Email
const batch3 = [
  ['MAS36220', 'MAS59568', 'Kamal.Singh@teammas.in'],
  ['MAS50768', 'MAS59568', 'rakesh.mandloi@teammas.in'],
  ['MAS47832', 'MAS59568', 'ansul.sharma@teammas.in'],
  ['MAS47157', 'MAS47782', 'sachin.ahuja1@teammas.in'],
  ['MAS47780', 'MAS47814', 'jatin.sethi@teammas.in'],
  ['MAS47782', 'MAS47814', 'harneet.kaur@teammas.in'],
  ['MAS47814', 'MAS59568', 'shivam.giri@teammas.in'],
  ['MAS49780', 'MAS47624', 'shivam.sharma5@teammas.co.in'],
  ['MAS57521', 'MAS47624', 'vipul.srivastav315@teammas.co.in'],
  ['MAS47962', 'MAS47624', 'Sachin.yadav@teamamas.co.in'],
  ['MAS48209', 'MAS47624', 'ayush.singh@teammas.co.in'],
  ['MAS58607', 'MAS47624', 'shivam.singh340@teammas.co.in'],
  ['MAS48858', 'MAS47624', 'nazim.khan@teammas.co.in'],
  ['MAS58048', 'MAS47624', 'ajay.goswami325@teammas.co.in'],
  ['MAS48555', 'MAS47832', 'neelam.bhardwaj@teammas.co.in'],
  ['MAS53104', 'MAS47780', 'brajesh.kumar187@teammas.co.in'],
  ['MAS49781', 'MAS47832', 'deepanshu.bisht@teammas.co.in'],
  ['MAS47327', 'MAS47832', 'Vicky.kumar1@teammas.co.in'],
  ['MAS47624', 'MAS47782', 'akash.kumar@teammas.co.in'],
  ['MAS50704', 'MAS47782', 'durgesh.singh@teammas.co.in'],
  ['MAS48872', 'MAS47782', 'ashutosh.singh@teammas.co.in'],
  ['MAS48651', 'MAS47782', 'meenu.singh@teammas.co.in'],
  ['MAS54387', 'MAS47782', 'naveen.kujur218@teammas.co.in'],
  ['MAS58241', 'MAS47780', 'tarun.aggarwal@teammas.co.in'],
  ['MAS48828', 'MAS47780', 'neilesh.kumar@teammas.co.in'],
  ['MAS49475', 'MAS47157', 'ayush.verma2@teammas.co.in'],
  ['MAS47451', 'MAS47832', 'udit.jain@teammas.co.in'],
  ['MAS51342', 'MAS47780', 'nitin.kumar129@teammas.co.in'],
  ['MAS48068', 'MAS47780', 'vijendra.kumar@teammas.co.in'],
  ['MAS49546', 'MAS47157', 'ramraj.singh@teammas.co.in'],
  ['MAS57097', 'MAS47157', 'pratyaksha.chakrwarti306@teammas.co.in'],
  ['MAS51399', 'MAS47157', 'vikas.kumar130@teammas.co.in'],
  ['MAS53865', 'MAS47157', 'pratham.pal203@teammas.co.in'],
  ['MAS58270', 'MAS47780', 'sumit332@teammas.co.in'],
  ['MAS51953', 'MAS47157', 'aditya.ruhela148@teammas.co.in'],
  ['MAS49499', 'MAS47157', 'arun.sharma@teammas.co.in'],
  ['MAS54394', 'MAS47832', 'nitish.kumar218@teammas.co.in'],
  ['MAS56391', 'MAS50768', 'shivam.mishra282@teammas.co.in'],
  ['MAS54920', 'MAS08226', 'sachin.vashisht236@teammas.co.in'],
  ['MAS60987', 'MAS08226', 'priyansu393@teammas.co.in'],
  ['MAS61446', 'MAS08226', 'abhishek.sharma404@teammas.co.in'],
  ['MAS08226', 'MAS59568', 'dinesh.mehta@teammas.in'],
  ['MAS50174', 'MAS08226', 'rohit.kumar@teammas.in'],
  ['MAS56606', 'MAS08226', 'prithvee@teammas.co.in'],
  ['MAS62520', 'MAS48209', 'vikash.yadav420@teammas.co.in'],
  ['MAS62525', 'MAS48209', 'rohit.raushan420@teammas.co.in'],
  ['MAS62526', 'MAS48209', 'krishna.prajapati420@teammas.co.in'],
  ['MAS62532', 'MAS48209', 'deepak.tiwari420@teammas.co.in'],
  ['MAS62530', 'MAS48209', 'akash.agarwal420@teammas.co.in'],
  ['MAS62527', 'MAS48209', 'lavlendra.singh420@teammas.co.in'],
  ['MAS62524', 'MAS48209', 'gopal.pandey420@teammas.co.in'],
  ['MAS62585', 'MAS48858', 'prashoon.madnawat421@mas.onfido.partners'],
  ['MAS62586', 'MAS48858', 'gulshan.kumar421@mas.onfido.partners'],
  ['MAS62590', 'MAS48858', 'aayush.barnwal421@mas.onfido.partners'],
  ['MAS62591', 'MAS48858', 'rahul421@mas.onfido.partners'],
  ['MAS62593', 'MAS48858', 'kundan.kumar421@mas.onfido.partners'],
  ['MAS62596', 'MAS48858', 'hitesh.mittal421@mas.onfido.partners'],
  ['MAS62597', 'MAS48858', 'deepanshu.verma421@mas.onfido.partners'],
  ['MAS62602', 'MAS48858', 'nikhil.saini421@mas.onfido.partners'],
  ['MAS62583', 'MAS48858', 'anshika.shukla421@mas.onfido.partners'],
  ['MAS62587', 'MAS48858', 'sandhya.kumari421@mas.onfido.partners'],
  ['MAS62599', 'MAS48858', 'chandni.bisht421@mas.onfido.partners'],
  ['MAS62588', 'MAS48858', 'shubhi.kanojia421@mas.onfido.partners'],
  ['MAS62683', 'MAS47962', 'ashish.kumar422@mas.onfido.partners'],
  ['MAS62671', 'MAS47962', 'anmol.sharma422@mas.onfido.partners'],
  ['MAS62672', 'MAS47962', 'ramit.kumar422@mas.onfido.partners'],
  ['MAS62669', 'MAS47962', 'abhishek.yadav422@mas.onfido.partners'],
  ['MAS62664', 'MAS47962', 'shubham.kumar422@mas.onfido.partners'],
  ['MAS62678', 'MAS47962', 'ravi.kumar422@mas.onfido.partners'],
  ['MAS62665', 'MAS47962', 'vinay.kumar422@mas.onfido.partners'],
  ['MAS62666', 'MAS47962', 'shiva.sharma422@mas.onfido.partners'],
  ['MAS62677', 'MAS47962', 'sunny.kumar422@mas.onfido.partners'],
  ['MAS53942', 'MAS49781', 'soni.kusahwaha@teammas.co.in'],
  ['MAS49537', 'MAS49781', 'anjali.singh@teammas.co.in'],
  ['MAS59278', 'MAS49781', 'srajal.sharma360@teammas.co.in'],
  ['MAS55656', 'MAS49781', 'sangeeta260@teammas.co.in'],
  ['MAS54820', 'MAS49781', 'mayank.singh232@teammas.co.in'],
  ['MAS60802', 'MAS49781', 'sonam389@teammas.co.in'],
  ['MAS55205', 'MAS49781', 'shadab.ansari246@teammas.co.in'],
  ['MAS61375', 'MAS49781', 'priya.rana401@teammas.co.in'],
  ['MAS61228', 'MAS49781', 'meenu.verma398@teammas.co.in'],
  ['MAS60094', 'MAS49781', 'prachi378@teammas.co.in'],
  ['MAS62476', 'MAS49781', 'shivani386@teammas.co.in'],
  ['MAS58396', 'MAS48068', 'mansi334@teammas.co.in'],
  ['MAS61903', 'MAS49781', 'anjum.yadav411@teammas.co.in'],
  ['MAS61907', 'MAS49781', 'himanshi.yadav411@teammas.co.in'],
  ['MAS60982', 'MAS49781', 'unnati.singh393@teammas.co.in'],
  ['MAS58746', 'MAS49781', 'poonam.rana343@teammas.co.in'],
  ['MAS62040', 'MAS49781', 'shikha.dangi413@teammas.co.in'],
  ['MAS56606', 'MAS47451', 'prithvee@teammas.co.in'],
  ['MAS49476', 'MAS47451', 'sonu.bhatt@teammas.co.in'],
  ['MAS51544', 'MAS47451', 'riddhi.singh@teammas.co.in'],
  ['MAS54008', 'MAS47451', 'pankaj.verma186@teammas.co.in'],
  ['MAS50706', 'MAS47451', 'mohit.sharma@teammas.co.in'],
  ['MAS51503', 'MAS47451', 'priyanshu.patel@teammas.co.in'],
  ['MAS58036', 'MAS47451', 'karishma.kumari325@teammas.co.in'],
  ['MAS56113', 'MAS47451', 'monika.solanki272@teammas.co.in'],
  ['MAS58505', 'MAS47451', 'arun.katariya337@teammas.co.in'],
  ['MAS61530', 'MAS47451', 'nisha.kumari404@teammas.co.in'],
  ['MAS55402', 'MAS47451', 'kajal.rawat252@teammas.co.in'],
  ['MAS56481', 'MAS47451', 'richa.tariyal286@teammas.co.in'],
  ['MAS60490', 'MAS47451', 'charu.jadaun385@teammas.co.in'],
  ['MAS56570', 'MAS47451', 'kriti.kumari290@teammas.co.in'],
  ['MAS59837', 'MAS47451', 'shaniya372@teammas.co.in'],
  ['MAS59103', 'MAS47451', 'chitra.nainwal355@teammas.co.in'],
  ['MAS58103', 'MAS47451', 'suhana.khan326@teammas.co.in'],
  ['MAS62272', 'MAS47451', 'suhail.ali416@teammas.co.in'],
  ['MAS60993', 'MAS47327', 'saloni.yadav393@teammas.co.in'],
  ['MAS60990', 'MAS47327', 'suman.kumari393@teammas.co.in'],
  ['MAS62034', 'MAS47327', 'akash413@teammas.co.in'],
  ['MAS62082', 'MAS47327', 'adarsh.kumar414@teammas.co.in'],
  ['MAS61652', 'MAS47327', 'ranjit.kumar406@teammas.co.in'],
  ['MAS61862', 'MAS47327', 'deepak.kumar410@teammas.co.in'],
  ['MAS61975', 'MAS47327', 'suryansh.rajput412@teammas.co.in'],
  ['MAS62085', 'MAS47327', 'mukul.tomar414@teammas.co.in'],
  ['MAS62099', 'MAS47327', 'sahid.alam414@teammas.co.in'],
  ['MAS61643', 'MAS47327', 'shivam.sharma406@teammas.co.in'],
  ['MAS61865', 'MAS47327', 'nitish.singh410@teammas.co.in'],
  ['MAS62094', null, 'shristi.sharma414@teammas.co.in'],
  ['MAS62549', null, 'sonali417@teammas.co.in'],
  ['MAS61648', null, 'dejy.kumari406@teammas.co.in'],
  ['MAS62496', null, 'ritik.roshan419@teammas.co.in'],
  ['MAS62493', null, 'nimay.yadav419@teammas.co.in'],
  ['MAS62490', null, 'shashi.bhushan419@teammas.co.in'],
  ['MAS61377', null, 'vivek401@teammas.co.in'],
  ['MAS59993', null, 'krishan.gopal376@teammas.co.in'],
  ['MAS60344', null, 'mithulal.mandal383@teammas.co.in'],
  ['MAS62342', null, 'abhishek.kumar417@teammas.co.in'],
  ['MAS62341', null, 'aman.kumar417@teammas.co.in'],
  ['MAS62338', null, 'ritik.roshan417@teammas.co.in'],
  ['MAS62340', null, 'vineet.kumar417@teammas.co.in'],
  ['MAS61735', null, 'ravi.kumar408@teammas.co.in'],
  ['MAS61593', null, 'pawan.bhainsora405@teammas.co.in'],
  ['MAS61896', null, 'amit.kumar411@teammas.co.in'],
  ['MAS60854', null, 'riju.kamboj390@teammas.co.in'],
  ['MAS60052', null, 'deeksha.dwivedi377@teammas.co.in'],
  ['MAS60719', null, 'preeti388@teammas.co.in'],
  ['MAS61905', null, 'anjali.negi411@teammas.co.in'],
  ['MAS61902', null, 'babli.rawat411@teammas.co.in'],
  ['MAS52406', null, 'ujjwal.tyagi160@teammas.co.in'],
  ['MAS53965', null, 'mohit.chauhan207@teammas.co.in'],
  ['MAS60671', null, 'sandeep.rajput387@teammas.co.in'],
  ['MAS60048', null, 'anshul.mishra377@teammas.co.in'],
  ['MAS56119', null, 'pradeep.chauhan272@teammas.co.in'],
  ['MAS54902', null, 'jeevanshu.saxena236@teammas.co.in'],
  ['MAS60662', null, 'sachin.kushwaha387@teammas.co.in'],
  ['MAS52903', null, 'nilesh.kumar179@teammas.co.in'],
  ['MAS59570', 'MAS51953', 'samarth.pratap224@teammas.co.in'],
  ['MAS61186', null, 'chaman.rautela397@teammas.co.in'],
  ['MAS61576', null, 'tannu.singh405@teammas.co.in'],
  ['MAS60843', null, 'priti.soni390@teammas.co.in'],
  ['MAS61491', null, 'sayma403@teammas.co.in'],
  ['MAS61577', null, 'chandani.khatoon405@teammas.co.in'],
  ['MAS59372', null, 'ramkishor362@teammas.co.in'],
  ['MAS60423', null, 'rupendra.khaiwal384@teammas.co.in'],
  ['MAS59099', null, 'deendayal.gaud355@teammas.co.in'],
  ['MAS61789', null, 'gourav.panchal409@teammas.co.in'],
  ['MAS61978', null, 'mohammad.faiz412@teammas.co.in'],
  ['MAS60601', null, 'syed.talib386@teammas.co.in'],
  ['MAS60594', null, 'mohd.amaan386@teammas.co.in'],
  ['MAS55281', null, 'roshan.kumar248@teammas.co.in'],
  ['MAS57822', null, 'rishikesh.kumar322@teammas.co.in'],
  ['MAS55170', null, 'sureshkumar.yadav244@teammas.co.in'],
  ['MAS60608', null, 'achal.sharma386@teammas.co.in'],
  ['MAS58998', 'MAS48068', 'shivani.pal250@teammas.co.in'],
  ['MAS57517', 'MAS48068', 'faizan315@teammas.co.in'],
  ['MAS54239', 'MAS48068', 'akash.kumar215@teammas.co.in'],
  ['MAS56887', 'MAS48068', 'vipin.kumar199@teammas.co.in'],
  ['MAS54483', 'MAS48068', 'sachin.sagar222@teammas.co.in'],
  ['MAS60661', 'MAS49781', 'vaishali.thapa387@teammas.co.in'],
  ['MAS57040', 'MAS48068', 'shivam.kumar303@teammas.co.in'],
  ['MAS59107', 'MAS48068', 'dhananjay.tripathi355@teammas.co.in'],
  ['MAS58555', 'MAS48068', 'vivek.tyagi339@teammas.co.in'],
  ['MAS58373', 'MAS48068', 'ritik.raushan333@teammas.co.in'],
  ['MAS54994', 'MAS48068', 'vishal.gupta238@teammas.co.in'],
  ['MAS55718', 'MAS48068', 'raushan.kumar262@teammas.co.in'],
  ['MAS61741', 'MAS48068', 'gaurav408@teammas.co.in'],
  ['MAS58332', 'MAS48068', 'abhishek.saini333@teammas.co.in'],
  ['MAS60208', 'MAS48068', 'jatin.mehta381@teammas.co.in'],
  ['MAS62266', null, 'kartikay.pundhir416@teammas.co.in'],
  ['MAS60273', 'MAS51953', 'ganesh.mehta382@teammas.co.in'],
  ['MAS57540', 'MAS51953', 'maha.nand317@teammas.co.in'],
  ['MAS52535', 'MAS51953', 'sadim165@teammas.co.in'],
  ['MAS60152', 'MAS47451', 'amankumar.agrawal380@teammas.co.in'],
  ['MAS61191', 'MAS51953', 'arjun.kumar397@teammas.co.in'],
  ['MAS51498', 'MAS51953', 'shubham.singh133@teammas.co.in'],
  ['MAS58094', 'MAS51953', 'rahul.kumar326@teammas.co.in'],
  ['MAS60660', 'MAS51953', 'deepak.gaud387@teammas.co.in'],
  ['MAS48907', 'MAS51953', 'ranjeet.sharma@teammas.co.in'],
  ['MAS53137', 'MAS51953', 'pawan.singh188@teammas.co.in'],
  ['MAS60674', 'MAS51953', 'azeem387@teammas.co.in'],
  ['MAS62268', null, 'rishiraj.tamrakar416@teammas.co.in'],
  ['MAS60665', 'MAS51953', 'shivamk.singh387@teammas.co.in'],
  ['MAS48705', 'MAS51953', 'krishna.kumar1@teammas.in'],
  ['MAS51679', 'MAS51953', 'monu.gangwar141@teammas.co.in'],
  ['MAS60675', 'MAS51953', 'priyanshu.singh387@teammas.co.in'],
  ['MAS59020', 'MAS51953', 'ajay.raina353@teammas.co.in'],
  ['MAS59418', null, 'gaurav364@teammas.co.in'],
  ['MAS61973', 'MAS49499', 'harsh.kumar412@teammas.co.in'],
  ['MAS61641', 'MAS49499', 'yogesh.soni406@teammas.co.in'],
  ['MAS59630', 'MAS49499', 'sunny.sumeria368@teammas.co.in'],
  ['MAS57522', 'MAS51399', 'manoj.kumar315@teammas.co.in'],
  ['MAS61901', 'MAS49499', 'naman.sharma411@teammas.co.in'],
  ['MAS61646', 'MAS49499', 'nitin.vishwakarma406@teammas.co.in'],
  ['MAS62029', 'MAS49499', 'ravi.kumar413@teammas.co.in'],
  ['MAS60673', 'MAS49499', 'shraddha.pandey387@teammas.co.in'],
  ['MAS60667', 'MAS49499', 'vaishali.tiwari387@teammas.co.in'],
  ['MAS60336', 'MAS49499', 'shivani.kumari383@teammas.co.in'],
  ['MAS62097', 'MAS49499', 'saniya.kumari414@teammas.co.in'],
  ['MAS59783', 'MAS49546', 'amit.kumar371@teammas.co.in'],
  ['MAS50072', 'MAS49546', 'pavan.kumar1@teammas.co.in'],
  ['MAS58920', 'MAS48068', 'shivam.sharma350@teammas.co.in'],
  ['MAS62028', 'MAS49546', 'nishant.karn413@teammas.co.in'],
  ['MAS62042', 'MAS49546', 'ritik.yadav413@teammas.co.in'],
  ['MAS61226', 'MAS49546', 'harsh.kaushik398@teammas.co.in'],
  ['MAS62274', 'MAS49546', 'vaibhav.sharma416@teammas.co.in'],
  ['MAS61908', 'MAS49546', 'jatin.bisht411@teammas.co.in'],
  ['MAS61899', 'MAS49546', 'yogesh.rawat411@teammas.co.in'],
  ['MAS62035', 'MAS49546', 'sikandar.rana413@teammas.co.in'],
  ['MAS62036', 'MAS49546', 'sonu.kumar413@teammas.co.in'],
  ['MAS62271', 'MAS49546', 'salman.shaikh416@teammas.co.in'],
  ['MAS59898', 'MAS51953', 'suraja.swal256@teammas.co.in'],
  ['MAS60518', 'MAS49546', 'himanshu.pal386@teammas.co.in'],
  ['MAS57265', 'MAS51399', 'naved.siddiqui310@teammas.co.in'],
  ['MAS61971', 'MAS49499', 'rakesh.roushan412@teammas.co.in'],
  ['MAS62176', 'MAS51399', 'ankur.bera415@teammas.co.in'],
  ['MAS61858', 'MAS51399', 'chandra.tiwari410@teammas.co.in'],
  ['MAS61972', 'MAS51399', 'amit.kumar412@teammas.co.in'],
  ['MAS60092', 'MAS51399', 'rishabhkumar.thakur378@teammas.co.in'],
  ['MAS60088', 'MAS51399', 'abhishek.kumar378@teammas.co.in'],
];

async function updateBatch3() {
  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  });

  try {
    console.log(`Processing ${batch3.length} employee records...\n`);

    let managerUpdates = 0;
    let emailUpdates = 0;
    let bothUpdates = 0;
    let errors = [];

    for (const [empCode, mgrCode, email] of batch3) {
      try {
        let managerId = null;

        // Get manager ID if manager code provided
        if (mgrCode) {
          const [mgrRows] = await connection.execute(
            'SELECT id FROM employees WHERE employee_code = ? LIMIT 1',
            [mgrCode]
          );

          if (mgrRows.length === 0) {
            errors.push(`${empCode}: Manager ${mgrCode} not found`);
            continue;
          }
          managerId = mgrRows[0].id;
        }

        // Build update query
        const updates = [];
        const params = [];

        if (managerId) {
          updates.push('reporting_manager_id = ?');
          params.push(managerId);
        }

        if (email) {
          updates.push('official_email = ?');
          params.push(email);
        }

        if (updates.length === 0) continue;

        params.push(empCode);

        const [result] = await connection.execute(
          `UPDATE employees SET ${updates.join(', ')} WHERE employee_code = ?`,
          params
        );

        if (result.affectedRows === 0) {
          errors.push(`${empCode}: Employee not found`);
        } else {
          if (managerId && email) {
            bothUpdates++;
            console.log(`✅ ${empCode} → Manager: ${mgrCode}, Email: ${email}`);
          } else if (managerId) {
            managerUpdates++;
            console.log(`✅ ${empCode} → Manager: ${mgrCode}`);
          } else if (email) {
            emailUpdates++;
            console.log(`✅ ${empCode} → Email: ${email}`);
          }
        }

      } catch (err) {
        errors.push(`${empCode}: ${err.message}`);
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ Both manager + email: ${bothUpdates}`);
    console.log(`✅ Manager only: ${managerUpdates}`);
    console.log(`✅ Email only: ${emailUpdates}`);
    console.log(`✅ Total successful: ${bothUpdates + managerUpdates + emailUpdates}`);
    console.log(`❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\nErrors (first 10):`);
      errors.slice(0, 10).forEach(err => console.log(`  - ${err}`));
      if (errors.length > 10) {
        console.log(`  ... and ${errors.length - 10} more`);
      }
    }

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

updateBatch3();
