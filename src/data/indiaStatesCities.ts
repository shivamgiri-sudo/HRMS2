/**
 * Curated (not exhaustive) State/UT -> major-city dataset for onboarding
 * address fields. ~15-25 cities per state: state capital, largest cities,
 * and known BPO/call-centre hub cities relevant to this business.
 *
 * "Other (type manually)" is always the last option in citiesForState()'s
 * returned array, not a separate concept — so a candidate whose city isn't
 * in the curated list is never blocked, just falls back to free text.
 *
 * This is the single canonical State list for the onboarding form — the
 * component that used to declare its own local INDIA_STATES imports it from
 * here instead. The backend's separate INDIAN_STATES copy in
 * onboarding-data.service.ts is deliberately left alone: the 10-step
 * onboarding form never calls that endpoint.
 */

export const INDIA_STATES: string[] = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat",
  "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh",
  "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab",
  "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh",
  "Uttarakhand", "West Bengal", "Delhi", "Jammu & Kashmir", "Ladakh",
  "Andaman & Nicobar Islands", "Chandigarh", "Dadra & Nagar Haveli", "Daman & Diu",
  "Lakshadweep", "Puducherry",
];

const OTHER_CITY = "Other (type manually)";

const STATE_CITIES: Record<string, string[]> = {
  "Andhra Pradesh": [
    "Visakhapatnam", "Vijayawada", "Guntur", "Nellore", "Kurnool", "Rajahmundry",
    "Tirupati", "Kadapa", "Kakinada", "Anantapur", "Vizianagaram", "Eluru",
    "Ongole", "Nandyal", "Machilipatnam", "Chittoor", "Srikakulam", "Amaravati",
  ],
  "Arunachal Pradesh": [
    "Itanagar", "Naharlagun", "Pasighat", "Tawang", "Ziro", "Bomdila",
    "Along", "Tezu", "Changlang", "Roing",
  ],
  "Assam": [
    "Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Nagaon", "Tinsukia",
    "Tezpur", "Bongaigaon", "Karimganj", "Sivasagar", "Goalpara", "Barpeta",
  ],
  "Bihar": [
    "Patna", "Gaya", "Bhagalpur", "Muzaffarpur", "Darbhanga", "Purnia",
    "Arrah", "Begusarai", "Katihar", "Munger", "Chhapra", "Bihar Sharif",
    "Sasaram", "Hajipur", "Siwan",
  ],
  "Chhattisgarh": [
    "Raipur", "Bhilai", "Bilaspur", "Korba", "Durg", "Rajnandgaon",
    "Jagdalpur", "Raigarh", "Ambikapur", "Dhamtari",
  ],
  "Goa": [
    "Panaji", "Margao", "Vasco da Gama", "Mapusa", "Ponda", "Bicholim", "Curchorem",
  ],
  "Gujarat": [
    "Ahmedabad", "Surat", "Vadodara", "Rajkot", "Bhavnagar", "Jamnagar",
    "Gandhinagar", "Junagadh", "Anand", "Nadiad", "Morbi", "Mehsana",
    "Bharuch", "Vapi", "Navsari", "Porbandar",
  ],
  "Haryana": [
    "Gurugram", "Faridabad", "Panipat", "Ambala", "Yamunanagar", "Rohtak",
    "Hisar", "Karnal", "Sonipat", "Panchkula", "Bhiwani", "Sirsa", "Kurukshetra",
  ],
  "Himachal Pradesh": [
    "Shimla", "Solan", "Dharamshala", "Mandi", "Kullu", "Hamirpur",
    "Una", "Bilaspur", "Chamba", "Nahan",
  ],
  "Jharkhand": [
    "Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Deoghar", "Hazaribagh",
    "Giridih", "Ramgarh", "Medininagar", "Dumka",
  ],
  "Karnataka": [
    "Bengaluru", "Mysuru", "Hubballi-Dharwad", "Mangaluru", "Belagavi",
    "Kalaburagi", "Davanagere", "Ballari", "Tumakuru", "Shivamogga",
    "Vijayapura", "Hassan", "Udupi", "Bidar", "Raichur", "Mandya",
  ],
  "Kerala": [
    "Thiruvananthapuram", "Kochi", "Kozhikode", "Thrissur", "Kollam",
    "Kannur", "Alappuzha", "Kottayam", "Palakkad", "Malappuram", "Kasaragod",
    "Pathanamthitta",
  ],
  "Madhya Pradesh": [
    "Bhopal", "Indore", "Jabalpur", "Gwalior", "Ujjain", "Sagar",
    "Dewas", "Satna", "Ratlam", "Rewa", "Katni", "Singrauli", "Burhanpur",
  ],
  "Maharashtra": [
    "Mumbai", "Pune", "Nagpur", "Nashik", "Thane", "Aurangabad", "Navi Mumbai",
    "Solapur", "Kolhapur", "Amravati", "Nanded", "Sangli", "Akola", "Latur",
    "Dhule", "Ahmednagar", "Chandrapur", "Jalgaon", "Satara", "Ratnagiri",
  ],
  "Manipur": [
    "Imphal", "Thoubal", "Bishnupur", "Churachandpur", "Kakching", "Ukhrul",
  ],
  "Meghalaya": [
    "Shillong", "Tura", "Jowai", "Nongstoin", "Baghmara",
  ],
  "Mizoram": [
    "Aizawl", "Lunglei", "Champhai", "Serchhip", "Kolasib",
  ],
  "Nagaland": [
    "Kohima", "Dimapur", "Mokokchung", "Tuensang", "Wokha",
  ],
  "Odisha": [
    "Bhubaneswar", "Cuttack", "Rourkela", "Berhampur", "Sambalpur",
    "Puri", "Balasore", "Bhadrak", "Baripada", "Jharsuguda", "Angul",
  ],
  "Punjab": [
    "Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda", "Mohali",
    "Hoshiarpur", "Pathankot", "Moga", "Firozpur", "Kapurthala",
  ],
  "Rajasthan": [
    "Jaipur", "Jodhpur", "Udaipur", "Kota", "Bikaner", "Ajmer",
    "Bhilwara", "Alwar", "Sikar", "Bharatpur", "Pali", "Sri Ganganagar", "Kishangarh", "Tonk",
  ],
  "Sikkim": [
    "Gangtok", "Namchi", "Gyalshing", "Mangan",
  ],
  "Tamil Nadu": [
    "Chennai", "Coimbatore", "Madurai", "Tiruchirappalli", "Salem", "Tirunelveli",
    "Erode", "Vellore", "Thoothukudi", "Dindigul", "Thanjavur", "Ranipet",
    "Nagercoil", "Kanchipuram", "Karur", "Cuddalore",
  ],
  "Telangana": [
    "Hyderabad", "Secunderabad", "Warangal", "Nizamabad", "Karimnagar", "Ramagundam",
    "Khammam", "Mahbubnagar", "Nalgonda", "Adilabad", "Suryapet", "Miryalaguda", "Siddipet",
  ],
  "Tripura": [
    "Agartala", "Udaipur", "Dharmanagar", "Kailashahar", "Belonia",
  ],
  "Uttar Pradesh": [
    "Lucknow", "Kanpur", "Noida", "Greater Noida", "Ghaziabad", "Agra", "Varanasi", "Meerut",
    "Prayagraj", "Allahabad", "Bareilly", "Aligarh", "Moradabad", "Saharanpur", "Gorakhpur",
    "Firozabad", "Jhansi", "Muzaffarnagar", "Mathura", "Rampur", "Shahjahanpur", "Farrukhabad",
    "Bulandshahr", "Hapur", "Bijnor", "Amroha",
  ],
  "Uttarakhand": [
    "Dehradun", "Haridwar", "Roorkee", "Haldwani", "Rudrapur",
    "Kashipur", "Rishikesh", "Nainital", "Almora",
  ],
  "West Bengal": [
    "Kolkata", "Howrah", "Durgapur", "Asansol", "Siliguri", "Bardhaman",
    "Malda", "Baharampur", "Habra", "Kharagpur", "Shantipur", "Ranaghat",
    "Haldia", "Raiganj", "Krishnanagar",
  ],
  "Delhi": [
    "New Delhi", "Dwarka", "Rohini", "Saket", "Karol Bagh", "Connaught Place",
    "Janakpuri", "Pitampura", "Vasant Kunj", "Lajpat Nagar", "Laxmi Nagar",
    "Shahdara", "Najafgarh", "Narela",
  ],
  "Jammu & Kashmir": [
    "Srinagar", "Jammu", "Anantnag", "Baramulla", "Sopore", "Kathua", "Udhampur",
  ],
  "Ladakh": [
    "Leh", "Kargil",
  ],
  "Andaman & Nicobar Islands": [
    "Port Blair", "Diglipur", "Mayabunder",
  ],
  "Chandigarh": [
    "Chandigarh",
  ],
  "Dadra & Nagar Haveli": [
    "Silvassa",
  ],
  "Daman & Diu": [
    "Daman", "Diu",
  ],
  "Lakshadweep": [
    "Kavaratti",
  ],
  "Puducherry": [
    "Puducherry", "Karaikal", "Mahe", "Yanam",
  ],
};

/** Cities dropdown for a given state, always ending in the manual-entry option. */
export function citiesForState(state: string): string[] {
  return [...(STATE_CITIES[state] ?? []), OTHER_CITY];
}

export { OTHER_CITY };
