const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;

export const E2E_RUN_ID = RUN_ID;

export const TEST_CANDIDATE = {
  fullName: 'Aman Test Verma',
  fatherName: 'Rajesh Test Verma',
  motherName: 'Sunita Test Verma',
  dob: '1998-04-15',
  gender: 'Male',
  maritalStatus: 'Single',
  mobile: `98765${String(Date.now()).slice(-5)}`,
  alternateMobile: '9876501235',
  email: `aman.test.verma+hrms2e2e-${RUN_ID}@example.com`,
  personalEmail: `aman.test.verma+personal-${RUN_ID}@example.com`,
  currentAddress: 'House 22, Sector 62, Noida, Uttar Pradesh, 201301',
  permanentAddress: 'Village Testpur, Kanpur, Uttar Pradesh, 208001',
  aadhaar: '999988887777',
  pan: 'ABCDE1234F',
  uan: '100200300400',
  bankAccount: '123456789012',
  ifsc: 'HDFC0001234',
  bankName: 'HDFC Bank',
  education: 'Graduate',
  experience: '1 year',
  appliedForBranch: 'Noida',
  appliedForProcess: 'Campaign B',
  department: 'Operations',
  designation: 'Executive',
  expectedCtcMonthly: 18000,
  doj: '2026-07-15',
};

export const NOMINEE = {
  nomineeName: 'Rajesh Test Verma',
  relation: 'Father',
  dob: '1972-06-10',
  sharePercentage: 100,
  address: 'Village Testpur, Kanpur, Uttar Pradesh, 208001',
};

export const EMERGENCY_CONTACT = {
  name: 'Rajesh Test Verma',
  relation: 'Father',
  mobile: '9876502222',
};

export const E2E_MARKER = `e2e_run_id=${RUN_ID}`;
