# SALCI Design System & UX Rules

## Brand Colors
- Primary: `#249ca2` (Use for primary buttons, active states, active borders, and primary branding).
- Secondary: `#fa920e` (Use for warning badges, secondary highlights, icons, and callouts).
- Backgrounds & Text: Rely on standard Tailwind gray/slate scales for neutral UI elements.

## Animation Constraints (Framer Motion)
- DO NOT wrap standard HTML elements in `<motion.div>` unless explicitly necessary for a complex transition.
- Use Framer Motion strictly for: Page-level fade-ins (`initial={{ opacity: 0 }} animate={{ opacity: 1 }}`), dialog/modal scale-ins, and complex micro-interactions.
- For standard button hovers and focus states, use native Tailwind transitions (e.g., `transition-colors duration-200`).

## UI/UX Rules
- Maintain all existing shadcn/ui component architectures.
- Increase whitespace: ensure logical padding (`p-4` to `p-6`) inside Cards.
- Never modify TanStack Query data fetching logic, Supabase calls, or React state when updating the UI.