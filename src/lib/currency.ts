/**
 * Format a number as Indian Rupees (INR)
 */
export const formatCurrency = (amount: number, showDecimals: boolean = false) => {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  }).format(amount);
};

/**
 * Format a number with Indian locale (lakhs, crores)
 */
export const formatNumber = (amount: number) => {
  return new Intl.NumberFormat("en-IN").format(amount);
};
