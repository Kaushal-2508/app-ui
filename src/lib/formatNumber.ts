/**
 * Format numbers for display in dashboards and stats
 * - Numbers under 1000: display as-is
 * - 1000+: display with comma separators (e.g., 1,234)
 * - 10000+: optionally display as compact (e.g., 10.5K)
 */
export function formatNumber(value: number | undefined | null, options?: {
  compact?: boolean;
  decimals?: number;
}): string {
  if (value === undefined || value === null) return "0";
  
  const { compact = false, decimals = 1 } = options || {};
  
  if (compact && Math.abs(value) >= 10000) {
    if (Math.abs(value) >= 1000000) {
      return `${(value / 1000000).toFixed(decimals)}M`;
    }
    return `${(value / 1000).toFixed(decimals)}K`;
  }
  
  // Use locale string for comma formatting
  return value.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
}

/**
 * Format percentage values
 */
export function formatPercent(value: number | undefined | null, decimals = 1): string {
  if (value === undefined || value === null) return "0%";
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format currency values in Indian Rupees (₹)
 */
export function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
