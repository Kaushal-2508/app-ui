import { Medal } from "lucide-react";

export function OlympiadPublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh surface-gradient">
      <header className="max-w-2xl mx-auto px-4 py-6 sm:py-8 flex items-center gap-2">
        <Medal className="h-6 w-6 text-brand-primary" />
        <p className="text-sm font-semibold text-ink-900">SALCI Olympiad</p>
      </header>
      <main className="max-w-2xl mx-auto px-4 pb-12">
        {children}
      </main>
      <footer className="max-w-2xl mx-auto px-4 py-6 text-[11px] text-ink-500 text-center">
        SALCI Olympiad · For queries, contact your school administration.
      </footer>
    </div>
  );
}
