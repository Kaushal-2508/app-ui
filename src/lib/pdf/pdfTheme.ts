// All units in millimetres. A4 portrait is 210 × 297.
export const PDF_THEME = {
  page: {
    width: 210,
    height: 297,
    marginX: 18,
    marginTop: 22,
    marginBottom: 18,
  },
  colors: {
    primary: "#249ca2",
    accent: "#fa920e",
    text: "#1f2937",
    muted: "#6b7280",
    border: "#e5e7eb",
    bandFill: "#f3f7f7",
    bucket: {
      mastered: "#10b981",   // > 80
      proficient: "#3b82f6", // 60–80
      developing: "#f59e0b", // 40–60
      needsWork: "#ef4444",  // < 40
    },
  },
  font: {
    family: "helvetica",
    sizes: {
      title: 22,
      h1: 16,
      h2: 12,
      body: 10,
      small: 8,
    },
    lineHeight: 1.4,
  },
  header: {
    logoMaxHeight: 14,
  },
} as const;

export type PdfTheme = typeof PDF_THEME;
