const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name] && process.env[name].trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// Employee data: code, name, manager name, email
const employeeData = [
  { code: 'MAS56168', name: 'KRISHAN KUMAR', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS59809', name: 'LAKSHMAN KUMAR BIND', manager: 'Faizan Khan', email: '' },
  { code: 'MAS60006', name: 'ANKIT KUMAR VASHISHTH', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS60417', name: 'HIMANSHU SINGH', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS61022', name: 'ROSHANI BHARTI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS61433', name: 'AKASH SINGH', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS55809', name: 'MEGHA CHAUHAN', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS60629', name: 'ANIKET SRIVASTAV', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS60537', name: 'DIVYANSHI PANCHAL', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS61431', name: 'ARUNENDRA TRIPATHI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS61762', name: 'GOPAL', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS61763', name: 'MOHD BILAL', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS61765', name: 'SHREYA TIWARI', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS60535', name: 'VANSH SRIVASTAV', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS51997', name: 'KAJAL', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS49862', name: 'SAMEER RAWAT', manager: 'Sandeep Singh', email: 'sameer.rawat@teammas.co.in' },
  { code: 'MAS61510', name: 'VIDESH KUMAR', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS55804', name: 'DIVYA KUMARI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS55808', name: 'KUMARI RUBI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS56293', name: 'DEEPAK VASHISHT', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS60840', name: 'PAWAN KUMAR', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS58878', name: 'HARSH DASILA', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS61422', name: 'KAJAL', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS61449', name: 'PRIYANSHU KUMAR', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS61843', name: 'NEHA SAHANI', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS61828', name: 'SHOBHIT PAL', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS61950', name: 'Yogyata Kumari', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS61943', name: 'SURAJ', manager: 'Sandeep Singh', email: 'mas61943@teammas.co.in' },
  { code: 'MAS61953', name: 'Jyoti Sharma', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62124', name: 'AKASH RATHOR', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62126', name: 'SAURABH DUBEY', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62068', name: 'AASHISH GAUTAM', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS62131', name: 'SALMANI ILMA', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62129', name: 'AFTAB AHAMAD', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS62231', name: 'RITESH KUMAR', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS62382', name: 'Shariq Shaikh', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS62312', name: 'UMA KUMARI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62313', name: 'HARSH KUNAR', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS62314', name: 'VISHAL SINGH', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS62282', name: 'HIMANSHU KUMAR', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS62563', name: 'ABDUL REHAMAN', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62564', name: 'MOHD NASEEM', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62567', name: 'KHUSHI MISHRA', manager: 'Sandeep Singh', email: '' },
  { code: 'MAS62568', name: 'PREETI MANDAL', manager: 'Aman Saraswat', email: '' },
  { code: 'MAS62565', name: 'HIMANSHI', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62689', name: 'UZAIF ARIF', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62697', name: 'FAHAD ANSARI', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62698', name: 'MD SAJRUDDIN ANSARI', manager: 'Vivek Ojha', email: '' },
  { code: 'MAS62699', name: 'RANI KHAN', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62700', name: 'AVIRAL DIXIT', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62701', name: 'ASHFIYA KHAN', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62702', name: 'POOJA TEVATIA', manager: 'Faizan Khan', email: '' },
  { code: 'MAS62838', name: 'VANSHIKA YADAV', manager: 'OJT', email: '' },
  { code: 'MAS62839', name: 'ANJALI KUMARI', manager: 'OJT', email: '' },
  { code: 'MAS62840', name: 'ASHUTOSH KASANA', manager: 'OJT', email: '' },
  { code: 'MAS62842', name: 'HARSH BHATT', manager: 'OJT', email: '' },
  { code: 'MAS62841', name: 'AKANKSHA GAUR', manager: 'OJT', email: '' },
  { code: 'MAS62845', name: 'MD FAIJAN AHMAD', manager: 'OJT', email: '' },
  { code: 'MAS62844', name: 'NEERAJ KUMAR', manager: 'OJT', email: '' },
  { code: 'MAS53558', name: 'Jyoti', manager: 'Vikarm', email: '' },
  { code: 'MAS53598', name: 'Deepanshu sharma', manager: 'Arbaz', email: '' },
  { code: 'MAS58754', name: 'Preeti', manager: 'Arbaz', email: 'mas58754@teammas.co.in' },
  { code: 'MAS60382', name: 'vikram singh', manager: 'Vikarm', email: '' },
  { code: 'MAS59650', name: 'Isha Negi', manager: 'Arbaz', email: '' },
  { code: 'MAS58007', name: 'Babita Thakur', manager: 'Vikarm', email: '' },
  { code: 'MAS58894', name: 'Kushal Upadhyay', manager: 'Vikarm', email: '' },
  { code: 'MAS60177', name: 'Hritik Gautam', manager: 'Vikarm', email: '' },
  { code: 'MAS60222', name: 'Himanshi', manager: 'Vikarm', email: '' },
  { code: 'MAS60367', name: 'Khushi Pandey', manager: 'Arbaz', email: '' },
  { code: 'MAS60729', name: 'Harshit', manager: 'Arbaz', email: '' },
  { code: 'MAS60933', name: 'Nishu', manager: 'Arbaz', email: '' },
  { code: 'MAS61068', name: 'Abhinav Srivastava', manager: 'Vikarm', email: '' },
  { code: 'MAS61096', name: 'Nikky', manager: 'Arbaz', email: '' },
  { code: 'MAS61066', name: 'Haresh', manager: 'Vikarm', email: '' },
  { code: 'MAS61275', name: 'Vineet', manager: 'Arbaz', email: '' },
  { code: 'MAS61271', name: 'Naveen', manager: 'Vikarm', email: '' },
  { code: 'MAS61272', name: 'Priyanka', manager: 'Vikarm', email: '' },
  { code: 'MAS61768', name: 'KAPIL KUMAR', manager: 'Vikarm', email: '' },
  { code: 'MAS62013', name: 'SACHIN YADAV', manager: 'Arbaz', email: '' },
  { code: 'MAS62014', name: 'ARPIT GANGWAR', manager: 'Arbaz', email: '' },
  { code: 'MAS62015', name: 'ABHAY JADAUN', manager: 'Vikarm', email: '' },
  { code: 'MAS62440', name: 'MUSKAN', manager: 'Vikarm', email: '' },
  { code: 'MAS62441', name: 'RITIKA GUPTA', manager: 'Arbaz', email: '' },
  { code: 'MAS62501', name: 'Yash', manager: 'Arbaz', email: '' },
  { code: 'MAS62720', name: 'KAVITA', manager: 'OJT', email: '' },
  { code: 'MAS62721', name: 'MAMTA', manager: 'OJT', email: '' },
  { code: 'MAS62722', name: 'MAHAK CHAUHAN', manager: 'OJT', email: '' },
  { code: 'MAS62725', name: 'KALINDI KUSHWAHA', manager: 'OJT', email: '' },
  { code: 'MAS62726', name: 'SHARAD KUMAR', manager: 'OJT', email: '' },
  { code: 'MAS62728', name: 'YASH PANDEY', manager: 'OJT', email: '' },
  { code: 'MAS62794', name: 'AKANSHA RANI', manager: 'OJT', email: '' },
  { code: 'MAS62795', name: 'POORVI', manager: 'OJT', email: '' },
  { code: 'MAS62796', name: 'SHIVANSHU SINGH', manager: 'OJT', email: '' },
  { code: 'MAS62797', name: 'RAJAT GOYAL', manager: 'OJT', email: '' },
  { code: 'MAS62798', name: 'VIPIN SINGH', manager: 'OJT', email: '' },
  { code: 'MAS58595', name: 'KUMKUM', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS58591', name: 'ANSHU', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS59006', name: 'Aditya kumar', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS59850', name: 'KAUSTUBH KUMAR', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS61853', name: 'TANISHQ SINGH', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS55838', name: 'Manish Dabas', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS61201', name: 'Abhishek', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS59849', name: 'SUNIL KUMAR', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS61477', name: 'ANISHKA SHARMA', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS61776', name: 'YOGENDRA VISHWAKARMA', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62074', name: 'KUNAL SHARMA', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62453', name: 'PRAGATI RAGHAV', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62429', name: 'Kunal Dobhal', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62500', name: 'Kakuli Dev Singh', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62658', name: 'Shohail Akhtar', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62660', name: 'Syed Akib Hussain', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62690', name: 'Jasica tyagi', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS62780', name: 'RAHUL KUMAR', manager: 'Jatin Nainwal', email: '' },
  { code: 'MAS55180', name: 'MANOJ KUMAR SINGH', manager: 'Shamsher', email: 'MAS55180@teammas.co.in' },
  { code: 'MAS54872', name: 'KM CHARU BHARADWAJ', manager: 'Shamsher', email: 'MAS54872@teammas.co.in' },
  { code: 'MAS53743', name: 'Akshay', manager: 'Saurabh', email: 'MAS53743@teammas.co.in' },
  { code: 'MAS58111', name: 'GUNJAN SHARMA', manager: 'Saurabh', email: 'mas58111@teammas.co.in' },
  { code: 'MAS58621', name: 'Rinki Sharma', manager: 'Shamsher', email: 'mas58621@teammas.co.in' },
  { code: 'MAS61010', name: 'Ansra Ameen', manager: 'Saurabh', email: 'mas61010@teammas.co.in' },
  { code: 'MAS61475', name: 'KAJAL CHAUHAN', manager: 'Saurabh', email: 'mas61475@teammas.co.in' },
  { code: 'MAS50411', name: 'Tushar', manager: 'Shamsher', email: 'MAS50411@teammas.co.in' },
  { code: 'MAS51303', name: 'Shubham Pandey', manager: 'Shamsher', email: 'MAS51303@teammas.co.in' },
  { code: 'MAS60770', name: 'SUNNY', manager: 'Shamsher', email: 'mas60770@teammas.co.in' },
  { code: 'MAS61474', name: 'MOHAMMAD SAAD', manager: 'Shamsher', email: 'mas61474@teammas.co.in' },
  { code: 'MAS60141', name: 'YASHMER SINGH SOAM', manager: 'Shamsher', email: 'mas60141@teammas.co.in' },
  { code: 'MAS61154', name: 'SATENDRA', manager: 'Saurabh', email: 'mas61154@teammas.co.in' },
  { code: 'MAS59483', name: 'MOHD DANISH', manager: 'Saurabh', email: 'mas59483@teammas.co.in' },
  { code: 'MAS57113', name: 'ATUL CHAUDHARY', manager: 'Shamsher', email: 'mas57113@teammas.co.in' },
  { code: 'MAS59480', name: 'NIKHIL SHARMA', manager: 'Saurabh', email: 'mas59480@teammas.co.in' },
  { code: 'MAS60143', name: 'UJJWAL SRIVASTAVA', manager: 'Shamsher', email: 'mas60143@teammas.co.in' },
  { code: 'MAS60144', name: 'AMIT TIWARI', manager: 'Saurabh', email: 'mas60144@teammas.co.in' },
  { code: 'MAS61476', name: 'NANDU KUMAR', manager: 'Shamsher', email: 'mas61476@teammas.co.in' },
  { code: 'MAS57208', name: 'SAGAR', manager: 'Saurabh', email: 'mas57208@teammas.co.in' },
  { code: 'MAS60142', name: 'ANURAG YADAV', manager: 'Saurabh', email: 'mas60142@teammas.co.in' },
  { code: 'MAS57213', name: 'Sanjeet', manager: 'Shamsher', email: 'mas57213@teammas.co.in' },
  { code: 'MAS62046', name: 'SADAT UZAIR ALI', manager: 'Saurabh', email: 'mas62046@teammas.co.in' },
  { code: 'MAS62067', name: 'SHALU ARYA', manager: 'Rohan', email: '' },
  { code: 'MAS57024', name: 'M GAURAV RAW', manager: 'Bidesh', email: 'MAS57024@teammas.co.in' },
  { code: 'MAS58974', name: 'SURJEET KOUR', manager: 'Bidesh', email: 'mas58974@teammas.co.in' },
  { code: 'MAS59369', name: 'Arushi', manager: 'Bidesh', email: 'mas59369@teammas.co.in' },
  { code: 'MAS59804', name: 'Shubham', manager: 'Bidesh', email: 'mas59804@teammas.co.in' },
  { code: 'MAS60428', name: 'ASHISH EKKA', manager: 'Bidesh', email: 'mas60428@teammas.co.in' },
  { code: 'MAS60429', name: 'TANISHA', manager: 'Bidesh', email: 'mas60429@teammas.co.in' },
  { code: 'MAS60682', name: 'Prachi', manager: 'Bidesh', email: 'mas60682@teammas.co.in' },
  { code: 'MAS61152', name: 'RAJ KUMAR', manager: 'Bidesh', email: 'mas61152@teammas.co.in' },
  { code: 'MAS61153', name: 'Prince kumar', manager: 'Bidesh', email: 'mas61153@teammas.co.in' },
  { code: 'MAS61400', name: 'MD Anwar Ali', manager: 'Bidesh', email: '' },
  { code: 'MAS61401', name: 'Bharti', manager: 'Bidesh', email: '' },
  { code: 'MAS60564', name: 'Rashmi', manager: 'Suraj', email: 'mas60564@teammas.co.in' },
  { code: 'MAS60772', name: 'Vikash Gaurav', manager: 'Suraj', email: 'mas60772@teammas.co.in' },
  { code: 'MAS60773', name: 'Nisha', manager: 'Suraj', email: 'mas60773@teammas.co.in' },
  { code: 'MAS60774', name: 'Anjali Gola', manager: 'Suraj', email: 'mas60774@teammas.co.in' },
  { code: 'MAS60775', name: 'Anubhav Sharma', manager: 'Suraj', email: 'mas60775@teammas.co.in' },
  { code: 'MAS50846', name: 'CHANCHAL', manager: 'Richa', email: 'MAS50846@teammas.co.in' },
  { code: 'MAS54531', name: 'SUHAIL SAIFI', manager: 'Manish', email: 'MAS54531@teammas.co.in' },
  { code: 'MAS57009', name: 'NIKHIL GIRI', manager: 'Manish', email: 'MAS57009@teammas.co.in' },
  { code: 'MAS57105', name: 'AKASH BHARTI', manager: 'Manish', email: '' },
  { code: 'MAS57478', name: 'MEGHA BISHT', manager: 'Janvi', email: 'mas57478@teammas.co.in' },
  { code: 'MAS59063', name: 'SHIVANI SINGH', manager: 'Richa', email: 'mas59063@teammas.co.in' },
  { code: 'MAS60705', name: 'Sahil panchal', manager: 'Richa', email: 'mas60705@teammas.co.in' },
  { code: 'MAS60701', name: 'Kumkum', manager: 'Richa', email: 'mas60701@teammas.co.in' },
  { code: 'MAS60702', name: 'Rihan', manager: 'Manish', email: 'mas60702@teammas.co.in' },
  { code: 'MAS60821', name: 'Piyush SHARMA', manager: 'Manish', email: 'mas60821@teammas.co.in' },
  { code: 'MAS61112', name: 'AKANSHA MISHRA', manager: 'Manish', email: 'mas61112@teammas.co.in' },
  { code: 'MAS61304', name: 'Naddem', manager: 'Richa', email: 'mas61304@teammas.co.in' },
  { code: 'MAS61389', name: 'Aman Tyagi', manager: 'Richa', email: '' },
  { code: 'MAS61392', name: 'Nandita Sharma', manager: 'Manish', email: '' },
  { code: 'MAS61393', name: 'Dikshita Gupta', manager: 'Richa', email: '' },
  { code: 'MAS61710', name: 'ABHAY MISHRA', manager: 'Shamsher', email: 'mas61710@teammas.co.in' },
  { code: 'MAS61683', name: 'Deepanshu', manager: 'Suraj', email: 'mas61683.gnc@teammas.co.in' },
  { code: 'MAS61685', name: 'ASHWIN PATHAK', manager: 'Manish', email: '' },
  { code: 'MAS61985', name: 'ISHA JHA', manager: 'Bidesh', email: 'mas61985@teammas.co.in' },
  { code: 'MAS62610', name: 'KHUSHI KAKKAR', manager: 'Bidesh', email: '' },
  { code: 'MAS62016', name: 'HRITIK SINGH', manager: 'Manish', email: '' },
  { code: 'MAS61268', name: 'ASHUTOSH', manager: 'Richa', email: '' },
  { code: 'MAS62727', name: 'Nandini', manager: 'Richa', email: '' },
  { code: 'MAS62734', name: 'Vedansh Kumar', manager: 'Shamsher', email: '' },
  { code: 'MAS56896', name: 'MUNNA KUMAR', manager: 'Suraj', email: 'munnakumar@teammas.co.in' },
  { code: 'MAS56922', name: 'TANNU RATHORE', manager: 'Suraj', email: 'tannurathore@teammas.co.in' },
  { code: 'MAS60869', name: 'VANSHIKA SINGH', manager: 'Suraj', email: 'mas60869.gnc@teammas.co.in' },
  { code: 'MAS60870', name: 'NEERAJ KUMAR', manager: 'Suraj', email: 'mas60870.gnc@teammas.co.in' },
  { code: 'MAS61610', name: 'AKASH SHARMA', manager: 'Suraj', email: '' },
  { code: 'MAS61715', name: 'AYUSHMANN CHAUHAN', manager: 'Rohan', email: '' },
  { code: 'MAS61716', name: 'DEVANSH SINGH', manager: 'Rohan', email: '' },
  { code: 'MAS61681', name: 'Vivek Kumar', manager: 'Suraj', email: 'mas61681.gnc@teammas.co.in' },
  { code: 'MAS58479', name: 'PREETI', manager: 'Rohan', email: 'mas58479@teammas.co.in' },
  { code: 'MAS58640', name: 'ANSHU SHUKLA', manager: 'Rohan', email: 'mas58640@teammas.co.in' },
  { code: 'MAS58945', name: 'PRATIKSHA', manager: 'Rohan', email: 'mas58945@teammas.co.in' },
  { code: 'MAS53603', name: 'Nitin Kumar', manager: 'Rohan', email: 'mas53603@teammas.co.in' },
  { code: 'MAS59343', name: 'DOLLY THAKUR', manager: 'Rohan', email: 'mas59343@teammas.co.in' },
  { code: 'MAS55622', name: 'ROHAN KUMAR', manager: 'Rohan', email: 'MAS55622@teammas.co.in' },
  { code: 'MAS60740', name: 'PARUL', manager: 'Rohan', email: '' },
  { code: 'MAS61011', name: 'SONAL', manager: 'Rohan', email: 'mas61011.gnc@teammas.co.in' },
  { code: 'MAS61551', name: 'Ayan', manager: 'Rohan', email: '' },
  { code: 'MAS61553', name: 'JAYJEET', manager: 'Rohan', email: '' },
  { code: 'MAS61550', name: 'SUMIT KUMAR', manager: 'Rohan', email: '' },
  { code: 'MAS61549', name: 'Vishnu', manager: 'Rohan', email: '' },
  { code: 'MAS61607', name: 'AFTAB ALI', manager: 'Rohan', email: '' },
  { code: 'MAS61707', name: 'SWATI RAI', manager: 'Dhananjay', email: 'mas61707@teammas.co.in' },
  { code: 'MAS54705', name: 'Rahul', manager: 'Rohan', email: 'rahul@teammas.co.in' },
  { code: 'MAS56873', name: 'AKASHSINGH', manager: 'Rohan', email: 'akashsingh@teammas.co.in' },
  { code: 'MAS57843', name: 'MOHAMMAD FAIZAN', manager: 'Rohan', email: 'mohammadfaizan@teammas.co.in' },
  { code: 'MAS60691', name: 'SHREYA KHANDELWAL', manager: 'Rohan', email: '' },
  { code: 'MAS61826', name: 'YASH RAJ CHAUHAN', manager: 'Bidesh', email: '' },
  { code: 'MAS61829', name: 'Swati', manager: 'Suraj', email: 'mas61829@teammas.co.in' },
  { code: 'MAS61944', name: 'ABHISHEK PAL', manager: 'Nishu', email: 'mas61944@teammas.co.in' },
  { code: 'MAS61939', name: 'AGRIM', manager: 'Janvi', email: 'mas61939@teammas.co.in' },
  { code: 'MAS61941', name: 'DEEPAK SHARMA', manager: 'Janvi', email: 'mas61941@teammas.co.in' },
  { code: 'MAS61934', name: 'TANU RANA', manager: 'Nishu', email: 'mas61934@teammas.co.in' },
  { code: 'MAS62106', name: 'Rajan Singh', manager: 'Manish', email: '' },
  { code: 'MAS62132', name: 'Radhika', manager: 'Nishu', email: '' },
  { code: 'MAS62133', name: 'Ankit', manager: 'Janvi', email: '' },
  { code: 'MAS62134', name: 'KAYENAT', manager: 'Nishu', email: '' },
  { code: 'MAS62144', name: 'SHYAM RUHELA', manager: 'Nishu', email: '' },
  { code: 'MAS62159', name: 'Dushyant', manager: 'Manish', email: '' },
  { code: 'MAS62161', name: 'Gaurav', manager: 'Richa', email: '' },
  { code: 'MAS62160', name: 'Shivam', manager: 'Richa', email: '' },
  { code: 'MAS62157', name: 'Kushboo', manager: 'Richa', email: '' },
  { code: 'MAS62299', name: 'KARTIK SINGH', manager: 'OJT', email: 'mas62299@teammas.co.in' },
  { code: 'MAS62291', name: 'MOHAMMAD TAUHEED MAZHAR', manager: 'Suraj', email: 'mas62291@teammas.co.in' },
  { code: 'MAS62300', name: 'PREM KUMAR', manager: 'Suraj', email: 'mas62300@teammas.co.in' },
  { code: 'MAS62201', name: 'Saba', manager: 'Richa', email: '' },
  { code: 'MAS62203', name: 'Sohail', manager: 'Richa', email: '' },
  { code: 'MAS62206', name: 'Archana', manager: 'Manish', email: '' },
  { code: 'MAS62293', name: 'Krishna', manager: 'Manish', email: '' },
  { code: 'MAS62298', name: 'Minakshi', manager: 'Nishu', email: '' },
  { code: 'MAS62295', name: 'Rohan Saini', manager: 'Janvi', email: '' },
  { code: 'MAS62541', name: 'PUSHPENDRA KUMAR', manager: 'Janvi', email: '' },
  { code: 'MAS62542', name: 'LALIT SHARMA', manager: 'Janvi', email: '' },
  { code: 'MAS62543', name: 'RITIKA KAUSHIK', manager: 'Nishu', email: '' },
  { code: 'MAS62544', name: 'SIDDHARTH SINGH', manager: 'Nishu', email: '' },
  { code: 'MAS62546', name: 'Hritik OJT', manager: 'OJT', email: '' },
  { code: 'MAS62540', name: 'Vivek', manager: 'OJT', email: '' },
  { code: 'MAS62545', name: 'ASIF SIDDIQUI', manager: 'OJT', email: '' },
  { code: 'MAS62548', name: 'Vishnu Priya', manager: 'OJT', email: '' },
  { code: 'MAS62547', name: 'Saurabh', manager: 'OJT', email: '' },
  { code: 'MAS62687', name: 'Wasi', manager: 'OJT', email: '' },
  { code: 'MAS62686', name: 'Manik', manager: 'OJT', email: '' },
  { code: 'MAS62609', name: 'mahak', manager: 'Manish', email: '' },
  { code: 'MAS62608', name: 'kanika', manager: 'Manish', email: '' },
  { code: 'MAS62613', name: 'Ankita', manager: 'Manish', email: '' },
  { code: 'MAS62611', name: 'MANVEE PATHAK', manager: 'Manish', email: '' },
  { code: 'MAS56101', name: 'Kanishka Sharma', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS57695', name: 'Rashmi Singh', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS56930', name: 'Akansha Paswaan', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS59259', name: 'Jagjeet Kaur', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS59258', name: 'Priya', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS59332', name: 'Malvika', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS60581', name: 'AKANKSHA', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS60586', name: 'SRISHTI VERMA', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS61915', name: 'Shreya Mishra', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS62105', name: 'SHUBHA JAIN SHARMA', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS62241', name: 'NIDHI SINHA', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS62733', name: 'Jahnvi', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS62800', name: 'ALIZA SINGH', manager: 'Aashima Kapila', email: '' },
  { code: 'MAS59365', name: 'Jamaal Ahamad', manager: 'Punnet', email: '' },
  { code: 'MAS59607', name: 'JITESH SHARMA', manager: 'Punnet', email: '' },
  { code: 'MAS61827', name: 'NISHANT SINGH', manager: 'Punnet', email: '' },
  { code: 'MAS61984', name: 'JATIN SINGH NEGI', manager: 'Punnet', email: '' },
  { code: 'MAS62582', name: 'ARJUN SHARMA', manager: 'Sachin', email: '' },
  { code: 'MAS62731', name: 'Nishtha Chauhan', manager: 'Sachin', email: '' },
  { code: 'MAS62729', name: 'Anju Haldar', manager: 'Sachin', email: '' },
  { code: 'MAS59962', name: 'SNEHA PANDEY', manager: 'Punnet', email: '' },
  { code: 'MAS60224', name: 'Manik Tuteja', manager: 'Punnet', email: '' },
  { code: 'MAS57576', name: 'Yatika', manager: 'Punnet', email: '' },
  { code: 'MAS60386', name: 'Chandresh', manager: 'Punnet', email: '' },
  { code: 'MAS60486', name: 'NIBHA', manager: 'Punnet', email: '' },
  { code: 'MAS61062', name: 'Minashi', manager: 'Punnet', email: '' },
  { code: 'MAS61396', name: 'Niharika', manager: 'Punnet', email: '' },
  { code: 'MAS61983', name: 'KANAK RANA', manager: 'Punnet', email: '' },
  { code: 'MAS62580', name: 'VISHAKHA GUPTA', manager: 'Sachin', email: '' },
  { code: 'MAS62581', name: 'AMAN DAHIYA', manager: 'Sachin', email: '' },
  { code: 'MAS61981', name: 'DEVESH KUMAR', manager: 'Punnet', email: '' },
  { code: 'MAS59576', name: 'Nisha Tomar', manager: 'Punnet', email: 'mas59576@teammas.co.in' },
  { code: 'MAS60223', name: 'Ujjwal Aswasti', manager: 'Punnet', email: '' },
  { code: 'MAS60776', name: 'MD ALAM', manager: 'Punnet', email: '' },
  { code: 'MAS59575', name: 'Rishabh Solanki', manager: 'Punnet', email: 'mas59575@teammas.co.in' },
  { code: 'MAS62396', name: 'KRISHNA MISHRA', manager: 'Punnet', email: '' },
  { code: 'MAS59169', name: 'RIYA TOMAR', manager: 'Punnet', email: '' },
  { code: 'MAS59771', name: 'ANUJ KUMAR', manager: 'Sachin', email: '' },
  { code: 'MAS60551', name: 'SHEETAL RATURI', manager: 'Sachin', email: '' },
  { code: 'MAS60641', name: 'SHAIKH EHTESHAM IBRAHIM', manager: 'Sachin', email: '' },
  { code: 'MAS60867', name: 'ANJUM ANSARI', manager: 'Sachin', email: '' },
  { code: 'MAS61507', name: 'Bhumika Jadon', manager: 'Sachin', email: '' },
  { code: 'MAS62109', name: 'CHANDRAKANTA', manager: 'Sachin', email: '' },
  { code: 'MAS62397', name: 'NEHA ANSARI', manager: 'Sachin', email: '' },
  { code: 'MAS62498', name: 'ROSHNI KHATOON', manager: 'Sachin', email: '' },
  { code: 'MAS62502', name: 'SAHABAJ ALI', manager: 'Sachin', email: '' },
  { code: 'MAS62503', name: 'SUBHAN', manager: 'Sachin', email: '' },
  { code: 'MAS62504', name: 'ESHIKA GHATANEY', manager: 'Sachin', email: '' },
  { code: 'MAS49273', name: 'PRIYANKA GUPTA', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS59253', name: 'VIJAY KUMAR BIRADAR', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS59447', name: 'S MOHAMMAD NAZEEM', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS61174', name: 'ABHISHEK SAINI', manager: 'Ashish Thomas', email: 'mas61174@teammas.co.in' },
  { code: 'MAS61202', name: 'Vikas', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS61673', name: 'Gaurav', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS61802', name: 'SARAN RAJ', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS62236', name: 'MONALISA MASANTA', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS62248', name: 'HARSH KUMAR', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS62566', name: 'SANDHYA JAISWAL', manager: 'Ashish Thomas', email: '' },
  { code: 'MAS58530', name: 'AMIT YADAV', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS59371', name: 'NIKHIL KUMAR PANDEY', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS60815', name: 'Abhishek Pandey', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62073', name: 'Priyanka Singh', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61561', name: 'NEELU SINGH', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62393', name: 'Ankita Yadav', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS57019', name: 'Beenu', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS53355', name: 'ARTI CHAUHAN', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61825', name: 'NEHA LAWANIYA', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62145', name: 'GUNGUN TYAGI', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS58767', name: 'CHHAVI GUPTA', manager: 'Kripa Shankar', email: 'mas58767@teammas.co.in' },
  { code: 'MAS60884', name: 'Poonam', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS59521', name: 'NAME SINGH', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS54666', name: 'ASIF', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS49564', name: 'DEEPA', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS52734', name: 'REKHA BISHT', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS60557', name: 'AKASH SHAH', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62781', name: 'TALA YASEEN', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS52098', name: 'TANUSHREE PRADHAN', manager: 'Kripa Shankar', email: 'tanushree.pradhan@teammas.co.in' },
  { code: 'MAS59813', name: 'Priyanka', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS60135', name: 'Akansh Singh', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS60487', name: 'PRAGATI BISHT', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS60186', name: 'Kalash Bhargav', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61338', name: 'SOUVIK BISWAL', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61469', name: 'Manjari Agrawal', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61850', name: 'Rahul Kumar', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62381', name: 'MANSI VAISH', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS62534', name: 'ASHISH VERMA', manager: 'Kripa Shankar', email: '' },
  { code: 'MAS61456', name: 'SANYA MASSEY', manager: 'Jyotsana', email: '' },
  { code: 'MAS61501', name: 'GAURI KUMARI', manager: 'Jyotsana', email: 'gaurikumari.lp@teammas.co.in' },
  { code: 'MAS61502', name: 'RASHMI', manager: 'Jyotsana', email: 'rashmi.lp@teammas.co.in' },
  { code: 'MAS61852', name: 'Tanu Bhardwaj', manager: 'Jyotsana', email: 'tanu.bhardwaj.lp@teammas.co.in' },
  { code: 'MAS61883', name: 'PRIYANKA BISHT', manager: 'Jyotsana', email: 'Priyanka.bisht.lp@teammas.co.in' },
  { code: 'MAS62281', name: 'SRINU NAYAK VADITHE', manager: 'Sanjay Rao', email: 'Srinunayakvadithe.lp@teammas.co.in' },
  { code: 'MAS62283', name: 'Geeta', manager: 'Sanjay Rao', email: 'geeta.lp@teammas.co.in' },
  { code: 'MAS62718', name: 'B Shivaji', manager: 'Sanjay Rao', email: 'b.shivaji.lp@teammas.co.in' },
  { code: 'MAS62719', name: 'Praveen Kumar', manager: 'Sanjay Rao', email: 'praveen.kumar.lp@teammas.co.in' },
  { code: 'MAS62436', name: 'KAMLESH CHAUDHARY', manager: 'Ishu Rana', email: 'kamlesh.lp@teammas.co.in' },
  { code: 'MAS62437', name: 'KOMAL', manager: 'Ishu Rana', email: 'komal.lp@teammas.co.in' },
  { code: 'MAS62438', name: 'DOLLY', manager: 'Ishu Rana', email: 'dolly.lp@teammas.co.in' },
  { code: 'MAS62836', name: 'KAVIYARASU', manager: 'Ishu Rana', email: 'kaviyarasu.lp@teammas.co.in' },
  { code: 'MAS61274', name: 'NEHA', manager: 'Bhawna Sood', email: '' },
  { code: 'MAS62643', name: 'PREETI', manager: 'Bhawna Sood', email: '' },
  { code: 'MAS62617', name: 'AKANKSHA RAI', manager: 'Bhawna Sood', email: '' },
  { code: 'MAS62614', name: 'KAJAL YADAV', manager: 'Bhawna Sood', email: '' },
  { code: 'MAS62843', name: 'Kiran Kumari', manager: 'Bhawna Sood', email: '' },
  { code: 'MAS62316', name: 'DIGAMBAR', manager: 'Vijay Biradar', email: 'digambargadde.lp@teammas.co.in' },
  { code: 'MAS62615', name: 'ASIT MOHAN RATH', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62619', name: 'DEEPAK BARUAH', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62620', name: 'LAXMAN RAO', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62621', name: 'IZAM ALI', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62622', name: 'PRANAY SHALIKRAM SHENDE', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62624', name: 'J.ANANTHALAKSHMI', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62625', name: 'PINKY SARKAR', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62616', name: 'SUNIL', manager: 'Vijay Biradar', email: '' },
  { code: 'MAS62641', name: 'LAKSHMI MOL S', manager: 'Vijay Biradar', email: '' },
];

async function updateBatch2() {
  const connection = await mysql.createConnection({
    host: requiredEnv('DB_HOST'),
    port: Number(process.env.DB_PORT || 3306),
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
  });

  try {
    console.log('Step 1: Building manager name -> ID mapping...\n');

    // Get unique manager names
    const uniqueManagers = [...new Set(employeeData.map(e => e.manager).filter(m => m && m !== 'OJT'))];

    const managerMap = new Map();

    for (const managerName of uniqueManagers) {
      // Try fuzzy match with LIKE
      const [rows] = await connection.execute(
        `SELECT id, full_name, employee_code FROM employees
         WHERE (full_name LIKE ? OR full_name LIKE ? OR full_name LIKE ?)
         AND active_status = 1
         LIMIT 1`,
        [`%${managerName}%`, `${managerName}%`, `%${managerName}`]
      );

      if (rows.length > 0) {
        managerMap.set(managerName, rows[0]);
        console.log(`✓ ${managerName} → ${rows[0].employee_code} (${rows[0].full_name})`);
      } else {
        console.log(`✗ ${managerName} → NOT FOUND`);
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`Step 2: Updating ${employeeData.length} employees...\n`);

    let managerUpdates = 0;
    let emailUpdates = 0;
    let skipped = 0;
    const errors = [];

    for (const emp of employeeData) {
      try {
        const updates = [];
        const params = [];

        // Handle manager assignment
        if (emp.manager && emp.manager !== 'OJT') {
          const manager = managerMap.get(emp.manager);
          if (manager) {
            updates.push('reporting_manager_id = ?');
            params.push(manager.id);
          } else {
            errors.push(`${emp.code}: Manager "${emp.manager}" not found in mapping`);
          }
        }

        // Handle email assignment
        if (emp.email) {
          updates.push('official_email = ?');
          params.push(emp.email);
        }

        if (updates.length === 0) {
          skipped++;
          continue;
        }

        params.push(emp.code);

        const [result] = await connection.execute(
          `UPDATE employees SET ${updates.join(', ')} WHERE employee_code = ?`,
          params
        );

        if (result.affectedRows === 0) {
          errors.push(`${emp.code}: Employee not found`);
        } else {
          if (updates.includes('reporting_manager_id = ?')) managerUpdates++;
          if (updates.includes('official_email = ?')) emailUpdates++;
          console.log(`✅ ${emp.code} → ${updates.join(', ')}`);
        }

      } catch (err) {
        errors.push(`${emp.code}: ${err.message}`);
      }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`✅ Manager assignments: ${managerUpdates}`);
    console.log(`✅ Email updates: ${emailUpdates}`);
    console.log(`⏭️  Skipped (no updates): ${skipped}`);
    console.log(`❌ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\nErrors (first 20):`);
      errors.slice(0, 20).forEach(err => console.log(`  - ${err}`));
      if (errors.length > 20) {
        console.log(`  ... and ${errors.length - 20} more`);
      }
    }

  } catch (err) {
    console.error('❌ Fatal error:', err.message);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

updateBatch2();
