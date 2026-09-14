/**
 * Convert a number to Indian Rupees in words
 * Example: 79062 -> "Seventy Nine Thousand Sixty Two Only"
 */
export function numberToWords(num: number): string {
  if (num === 0) return "Zero Only";

  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = [
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const convertLessThanThousand = (n: number): string => {
    if (n === 0) return "";
    if (n < 10) return ones[n];
    if (n < 20) return teens[n - 10];
    if (n < 100) {
      const ten = Math.floor(n / 10);
      const one = n % 10;
      return tens[ten] + (one > 0 ? " " + ones[one] : "");
    }
    const hundred = Math.floor(n / 100);
    const rest = n % 100;
    return ones[hundred] + " Hundred" + (rest > 0 ? " " + convertLessThanThousand(rest) : "");
  };

  // Indian numbering system: crores, lakhs, thousands, hundreds
  const crores = Math.floor(num / 10000000);
  const lakhs = Math.floor((num % 10000000) / 100000);
  const thousands = Math.floor((num % 100000) / 1000);
  const hundreds = num % 1000;

  let result = "";

  if (crores > 0) {
    result += convertLessThanThousand(crores) + " Crore ";
  }
  if (lakhs > 0) {
    result += convertLessThanThousand(lakhs) + " Lakh ";
  }
  if (thousands > 0) {
    result += convertLessThanThousand(thousands) + " Thousand ";
  }
  if (hundreds > 0) {
    result += convertLessThanThousand(hundreds);
  }

  return result.trim() + " Only";
}
