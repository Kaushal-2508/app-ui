export type OlympiadFeeBreakdown = {
  baseRupees: string;
  gstRupees: string;
  totalRupees: string;
  display: string;
};

function formatRupees(rupees: number): string {
  return Number.isInteger(rupees) ? `₹${rupees.toFixed(0)}` : `₹${rupees.toFixed(2)}`;
}

export function formatOlympiadFee(baseRupees: number, gstPercent: number): OlympiadFeeBreakdown {
  if (!Number.isFinite(baseRupees) || baseRupees <= 0) {
    throw new Error("baseRupees must be a positive number");
  }
  if (!Number.isFinite(gstPercent) || gstPercent < 0 || gstPercent > 100) {
    throw new Error("gstPercent must be between 0 and 100");
  }

  // Keep money exact to the paisa: round GST to 2 decimals.
  const gstValue = Math.round(baseRupees * gstPercent) / 100;
  const totalValue = baseRupees + gstValue;

  return {
    baseRupees: formatRupees(baseRupees),
    gstRupees: formatRupees(gstValue),
    totalRupees: formatRupees(totalValue),
    display: `${formatRupees(baseRupees)} + ${gstPercent.toFixed(0)}% GST = ${formatRupees(totalValue)}`,
  };
}
