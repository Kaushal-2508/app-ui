import { useState } from "react";
import {
  Trophy,
  Award,
  Medal,
  Star,
  TrendingUp,
  Download,
  ArrowRight,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import { useOlympiadPublishedResultUrl } from "@/hooks/olympiad/useOlympiadPublishedResultUrl";
import type { PublishedResult } from "@/hooks/olympiad/useOlympiadPublishedResult";

type ResultData = Extract<PublishedResult, { ok: true }>;

type TierConfig = {
  label: string;
  icon: LucideIcon;
  ring: [string, string, string];
  iconClass: string;
  labelGrad: string;
  starClass: string;
  glowClass: string;
};

const TIER: Record<string, TierConfig> = {
  gold: {
    label: "Gold",
    icon: Trophy,
    ring: ["#ffe9a8", "#f3c357", "#d99a2b"],
    iconClass: "text-[#f5cd63]",
    labelGrad: "from-[#ffe9a8] to-[#f1c052]",
    starClass: "text-[#f3c357]",
    glowClass: "bg-[#ffce73]/30",
  },
  silver: {
    label: "Silver",
    icon: Award,
    ring: ["#f4f7fa", "#cdd6df", "#9fabb8"],
    iconClass: "text-[#dbe3ea]",
    labelGrad: "from-[#eef2f6] to-[#c2ccd6]",
    starClass: "text-[#cdd6df]",
    glowClass: "bg-[#cfdae6]/25",
  },
  bronze: {
    label: "Bronze",
    icon: Medal,
    ring: ["#f1cea3", "#d99a5e", "#b06f31"],
    iconClass: "text-[#e7b07a]",
    labelGrad: "from-[#f0c79a] to-[#cc8a4e]",
    starClass: "text-[#d99a5e]",
    glowClass: "bg-[#e0a36a]/30",
  },
  participation: {
    label: "Participation",
    icon: Star,
    ring: ["#a7e3e0", "#3aa9a4", "#1f8e92"],
    iconClass: "text-[#cdeeec]",
    labelGrad: "from-[#cdeeec] to-[#5bbdb9]",
    starClass: "text-[#7fd3d0]",
    glowClass: "bg-white/20",
  },
  absent: {
    label: "Absent",
    icon: Star,
    ring: ["#cdd6df", "#aab4bf", "#8794a1"],
    iconClass: "text-[#dbe3ea]",
    labelGrad: "from-[#e2e8f0] to-[#aab4bf]",
    starClass: "text-[#aab4bf]",
    glowClass: "bg-white/12",
  },
};

/** Award medallion with ribbon — tier-coloured ring over a deep-teal core. */
function TierMedallion({ cfg, className }: { cfg: TierConfig; className?: string }) {
  const Glyph = cfg.icon;
  return (
    <div className={cn("relative mb-1 h-[104px] w-[92px]", className)}>
      <svg
        viewBox="0 0 92 104"
        className="absolute inset-0 h-full w-full drop-shadow-[0_10px_16px_rgba(0,0,0,0.3)]"
        aria-hidden
      >
        <defs>
          <linearGradient id="tier-ring" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={cfg.ring[0]} />
            <stop offset="0.5" stopColor={cfg.ring[1]} />
            <stop offset="1" stopColor={cfg.ring[2]} />
          </linearGradient>
        </defs>
        <path d="M34 56 L26 100 L40 90 L46 99 L52 90 L66 100 L58 56 Z" fill="#0f6066" />
        <path d="M37 58 L31 92 L40 86 L46 94 L52 86 L61 92 L55 58 Z" fill="#0c4d52" />
        <circle cx="46" cy="40" r="35" fill="url(#tier-ring)" />
        <circle cx="46" cy="40" r="35" fill="none" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="1.5" />
        <circle cx="46" cy="40" r="27" fill="#0e5a61" />
      </svg>
      <Glyph
        className={cn(
          "absolute left-[46px] top-[40px] h-[26px] w-[26px] -translate-x-1/2 -translate-y-1/2",
          cfg.iconClass,
        )}
      />
    </div>
  );
}

/** Glass answer-breakdown panel with an accuracy ring — the hero's right column. */
function AnswerPanel({ correct, incorrect, total, accuracyPct }: {
  correct: number;
  incorrect: number;
  total: number;
  accuracyPct: number;
}) {
  const R = 46;
  const C = 2 * Math.PI * R;
  const offset = C * (1 - Math.min(100, Math.max(0, accuracyPct)) / 100);
  return (
    <div className="w-full rounded-2xl border border-white/20 bg-white/10 p-5 md:w-[330px] md:shrink-0">
      <p className="mb-3.5 text-center text-[10.5px] font-bold uppercase tracking-[0.14em] text-white/75">
        How you answered
      </p>
      <div className="flex items-center gap-4">
        <div className="relative h-[112px] w-[112px] shrink-0">
          <svg width="112" height="112" viewBox="0 0 112 112" className="-rotate-90" aria-hidden>
            <circle cx="56" cy="56" r={R} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="12" />
            <circle
              cx="56" cy="56" r={R}
              fill="none" stroke="#34d399" strokeWidth="12" strokeLinecap="round"
              strokeDasharray={C} strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[24px] font-extrabold leading-none text-white">{accuracyPct}%</span>
            <span className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.08em] text-white/70">Accuracy</span>
          </div>
        </div>
        <div className="flex-1">
          <Legend color="bg-emerald-400" label="Correct" value={correct} />
          <Legend color="bg-rose-400" label="Incorrect" value={incorrect} />
          <Legend color="bg-white/50" label="Total" value={total} />
        </div>
      </div>
    </div>
  );
}

function Legend({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5 py-[5px]">
      <span className={cn("h-2.5 w-2.5 shrink-0 rounded-sm", color)} />
      <span className="flex-1 text-xs font-semibold text-white/85">{label}</span>
      <span className="text-sm font-extrabold tabular-nums text-white">{value}</span>
    </div>
  );
}

export function PublishedResultCard({ result }: { result: ResultData }) {
  const getUrl = useOlympiadPublishedResultUrl();
  const [busy, setBusy] = useState<"result" | "certificate" | null>(null);
  const cfg = TIER[result.certificate_tier] ?? TIER.participation;

  const downloadPdf = async (kind: "result" | "certificate") => {
    setBusy(kind);
    try {
      const url = await getUrl.mutateAsync({ resultId: result.result_id, kind });
      openExternal(url);
    } catch {
      // toastError fires in the mutation's onError; the catch keeps the rejected
      // mutateAsync from surfacing as a global "unexpected error" toast.
    } finally {
      setBusy(null);
    }
  };

  const isAbsent = result.certificate_tier === "absent";
  const topClass = result.class_rank === 1;
  const topSchool = result.school_rank === 1;
  const celebrate = !isAbsent && (topClass || topSchool);
  const celebrateText =
    topClass && topSchool
      ? "1st in your class & school"
      : topClass
        ? "1st in your class"
        : "1st in your school";

  // Answer breakdown (1 mark / MCQ → marks == answers) + percentile from the
  // strongest available standing.
  const correct = Math.round(Number(result.total_marks_obtained));
  const max = Math.round(Number(result.total_max_marks));
  const incorrect = Math.max(0, max - correct);
  const accuracyPct = Math.round(Number(result.percentage));
  const standRank = result.school_rank ?? result.class_rank;
  const standTotal = result.school_rank ? result.school_total : result.class_total;
  const topPct = standRank && standTotal ? Math.max(1, Math.round((standRank / standTotal) * 100)) : null;

  return (
    <div className="surface-card frosted-shadow rounded-card overflow-hidden">
      {/* Hero — left: identity, right: answer-breakdown graphic */}
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-primary via-[#15828a] to-[#0e5a61] p-6 sm:p-7">
        <div aria-hidden className="pointer-events-none absolute left-[22%] -top-10 h-44 w-72 -translate-x-1/2 rounded-full bg-white/16 blur-3xl" />
        <div aria-hidden className={cn("pointer-events-none absolute left-[74%] top-1/3 h-44 w-72 -translate-x-1/2 rounded-full blur-3xl", cfg.glowClass)} />

        <div className="relative flex flex-col items-center gap-6 text-center md:flex-row md:items-center md:justify-between md:gap-8 md:text-left">
          {/* LEFT — identity: medal beside the result text */}
          <div className="flex flex-col items-center gap-1 md:flex-row md:items-center md:gap-5">
            <TierMedallion cfg={cfg} className="md:mb-0" />
            <div className="flex flex-col items-center md:items-start">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/80">Your result</p>
              <div className="mt-2 inline-flex items-center gap-2.5">
                <Star className={cn("h-3 w-3 fill-current", cfg.starClass)} />
                <span
                  className={cn(
                    "bg-gradient-to-b bg-clip-text text-sm font-extrabold uppercase tracking-[0.24em] text-transparent",
                    cfg.labelGrad,
                  )}
                >
                  {cfg.label}
                </span>
                <Star className={cn("h-3 w-3 fill-current", cfg.starClass)} />
              </div>

              {!isAbsent && (
                <>
                  <p className="mt-2 text-[44px] font-extrabold leading-none text-white">
                    {correct} <span className="text-3xl font-bold text-white/55">/ {max}</span>
                  </p>
                  <p className="mt-1.5 text-lg font-bold text-white/90">
                    {Number(result.percentage).toFixed(2)}%
                  </p>
                  {celebrate && (
                    <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/12 px-4 py-1.5 text-xs font-bold text-white">
                      <Trophy className="h-3.5 w-3.5" />
                      {celebrateText}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* RIGHT — answer breakdown */}
          {!isAbsent && (
            <AnswerPanel correct={correct} incorrect={incorrect} total={max} accuracyPct={accuracyPct} />
          )}
        </div>
      </div>

      {/* Body */}
      {!isAbsent ? (
        <div className="space-y-4 p-5 sm:p-6">
          {result.class_rank != null && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-3 rounded-2xl border border-brand-primary/20 bg-brand-primary/10 p-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary/15 text-brand-primary">
                  <Medal className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-brand-primary">Class rank</p>
                  <p className="text-xl font-extrabold leading-tight text-ink-900">
                    {result.class_rank}{" "}
                    <span className="text-sm font-medium text-ink-500">of {result.class_total}</span>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 rounded-2xl border border-brand-secondary/20 bg-brand-secondary/10 p-3.5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-secondary/15 text-brand-secondary">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-brand-secondary">Percentile</p>
                  <p className="text-xl font-extrabold leading-tight text-ink-900">
                    {topPct != null ? (
                      <>Top {topPct}<span className="text-sm font-medium text-ink-500">%</span></>
                    ) : (
                      "N/A"
                    )}
                  </p>
                </div>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <Button
              variant="secondary"
              className="h-12 flex-1 border-0 bg-brand-primary bg-none text-white shadow-sm hover:bg-brand-primary/90"
              disabled={busy !== null || !result.result_pdf_path}
              onClick={() => downloadPdf("result")}
            >
              {busy === "result" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download report
            </Button>
            <Button
              variant="secondary"
              className="h-12 flex-1 border-0 bg-brand-accent bg-none text-white shadow-sm hover:bg-brand-accent/90"
              disabled={busy !== null || !result.certificate_pdf_path}
              onClick={() => downloadPdf("certificate")}
            >
              {busy === "certificate" ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Download certificate
            </Button>
          </div>

          <NavLink to="/student/olympiad/review">
            <Button
              variant="ghost"
              className="h-11 w-full text-brand-primary hover:bg-brand-primary/10 hover:text-brand-primary"
            >
              Review your answers
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </NavLink>
        </div>
      ) : (
        <p className="p-6 text-center text-sm text-ink-700">
          You did not attempt the exam. Contact your school if this is an error.
        </p>
      )}
    </div>
  );
}
