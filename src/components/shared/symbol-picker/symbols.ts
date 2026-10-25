export interface SymbolPage {
  label: string;
  symbols: string[];
  /** Marks the dynamic "Frequently used" page so the header can show a
   *  different icon. Static curated pages omit this. */
  recommended?: boolean;
}

export const SYMBOL_PAGES: SymbolPage[] = [
  {
    label: "Math basics",
    symbols: [
      "+", "−", "×", "÷", "=", "≠", "≈", "≡",
      "<", ">", "≤", "≥", "±", "∓", "∝", "∞",
      "√", "∛", "∜", "%", "‰", "°", "′", "″",
      "·", "∘", "⊕", "⊖", "⊗", "⊘", "→", "↦",
    ],
  },
  {
    label: "Greek letters",
    symbols: [
      "α", "β", "γ", "δ", "ε", "ζ", "η", "θ",
      "ι", "κ", "λ", "μ", "ν", "ξ", "π", "ρ",
      "σ", "τ", "υ", "φ", "χ", "ψ", "ω", "Δ",
      "Σ", "Π", "Ω", "Φ", "Λ", "Θ", "Ξ", "Γ",
    ],
  },
  {
    label: "Powers & subscripts",
    // Superscript digits + operators on top two rows so users can compose
    // any exponent (e.g. 4²⁵, 10⁻³, xⁿ). Subscripts on the bottom two rows
    // (e.g. H₂O, x₁, aₙ).
    symbols: [
      "⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷",
      "⁸", "⁹", "⁺", "⁻", "⁼", "⁽", "⁾", "ⁿ",
      "₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇",
      "₈", "₉", "₊", "₋", "₌", "₍", "₎", "ₓ",
    ],
  },
  {
    label: "Sets, logic & arrows",
    symbols: [
      "∈", "∉", "⊂", "⊆", "⊃", "∪", "∩", "∅",
      "∀", "∃", "¬", "∧", "∨", "⊥", "∥", "∠",
      "≅", "△", "□", "○", "⇒", "⇔", "↑", "↓",
      "↔", "½", "⅓", "¼", "¾", "₹", "©", "®",
    ],
  },
];
