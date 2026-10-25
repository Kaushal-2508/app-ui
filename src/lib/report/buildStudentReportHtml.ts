import { format, parseISO } from "date-fns";

import { compareToClassAverage } from "@/lib/performanceLabels";
import type {
  YearReport,
  YearReportChapter,
  YearReportSubject,
  YearReportExam,
} from "@/hooks/useStudentYearReport";

/**
 * Builds the student's downloadable year report as a self-contained HTML string.
 *
 * LAYOUT follows public/report_reference/student_report_mockup_2.html: page one
 * opens with a HERO BAND (illustration, school lockup, title overlaid), the
 * student ID card overlapping its bottom edge, and content starting straight
 * after on the same page. It is deliberately NOT a standalone cover page - that
 * wasted most of a sheet and looked nothing like the reference.
 *
 * FOUR pages, guaranteed: page one is fixed, sections 3-8 flow through a greedy
 * packer, and the two variable-length tables (chapters, assessment log) are
 * capped. If the packer still overruns, assembly retries with tighter caps
 * (see CAP_LADDER) until it fits. Truncation is always disclosed in-page.
 *
 * Sheets are overflow:hidden, so every height estimate is conservative:
 * over-estimating wastes millimetres, under-estimating CUTS content.
 *
 * RENDERER CONSTRAINTS (html2canvas rasterises each sheet to its own canvas and
 * jsPDF places one sheet per A4 page - see DownloadReportButton):
 *   - no flex-centered TEXT in small boxes (glyphs drift bottom-left): badges
 *     and avatars centre with line-height
 *   - no native list markers (never drawn): bullets are literal glyphs
 *   - no decorative gradients (they band): flat fills, hairline borders
 *   - inline tags carry fixed height/line-height and no vertical padding
 *   - charts are hand-built inline SVG (a charting library has no layout pass
 *     in a detached node)
 */

export interface ReportHeaderInfo {
  studentName: string;
  className: string | null;
  section: string | null;
  rollNumber: string | null;
  admissionNumber: string | null;
  schoolName: string;
  schoolAddress: string | null;
  /** Data URLs. Null falls back to a flat teal band / text lockup. */
  coverDataUrl: string | null;
  logoDataUrl: string | null;
}

/** SALCI print palette, literal hex (CSS custom properties do not resolve in a
 *  detached node). Teal = student, slate = class, orange = needs attention. */
const C = {
  teal: "#249ca2",
  tealInk: "#17696d",
  tealWash: "#eef6f6",
  slate: "#64748b",
  slateWash: "#f1f3f5",
  orange: "#fa920e",
  orangeInk: "#8a4f00",
  orangeWash: "#fdf3e4",
  red: "#c0392b",
  redWash: "#fbeeec",
  ink: "#1a1c1e",
  ink2: "#4a4d52",
  muted: "#7c8087",
  line: "#e2e5e8",
  track: "#eef0f2",
};

/** Content budget for a full sheet, in CSS px: 297mm less 14mm/16mm padding and
 *  the running footer, less a safety margin. */
const PAGE_BUDGET = 975;
/** Budget for page one, which also carries the hero band and the ID card. */
const PAGE1_BUDGET = 560;

// Calibrated against a real render, not guessed: a heading plus its subtitle
// measures ~45px and a bare heading ~28px. The earlier 64/42 estimates wasted
// roughly 110px per sheet, which forced premature page breaks and made the
// degradation ladder drop content that would otherwise have fitted.
const SEC_HEAD_H = 48;
const SEC_HEAD_BARE_H = 30;
const TABLE_HEAD_H = 30;
const SUBJECT_ROW_H = 38;
const DETAIL_ROW_H = 34;

/**
 * Degradation ladder: [focus cards, chapter rows, log rows], tried in order
 * until the report fits four pages. Table rows are sacrificed before focus
 * areas, because a dropped focus area loses advice while a dropped table row
 * only loses detail that the averages above already account for. The last rung
 * always fits. Every truncation is disclosed in-page.
 */
const CAP_LADDER: [number, number, number][] = [
  [3, 10, 16],
  [3, 8, 14],
  [3, 6, 12],
  [3, 5, 10],
  [3, 4, 8],
  [2, 4, 8],
  [2, 3, 6],
  [1, 3, 6],
];

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pct(v: number | null | undefined, dp = 1): string {
  return v == null ? "N/A" : `${v.toFixed(dp)}%`;
}

function d(iso: string | null | undefined, fmt = "d MMM yyyy"): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), fmt);
  } catch {
    return String(iso);
  }
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "S"
  );
}

/** Greedy in-page packer for the sheets after page one. */
class Packer {
  readonly pages: string[][] = [];
  private cur: string[] = [];
  private used = 0;

  flush(): void {
    if (this.cur.length) {
      this.pages.push(this.cur);
      this.cur = [];
      this.used = 0;
    }
  }

  push(html: string, h: number): void {
    if (this.used + h > PAGE_BUDGET && this.cur.length) this.flush();
    this.cur.push(html);
    this.used += h;
  }
}

function barColor(v: number): string {
  if (v < 50) return C.red;
  if (v < 65) return C.orange;
  return C.teal;
}

/** Subject rows colour their meter by the VERDICT so it agrees with the status
 *  tag on the same row. Chapter rows keep absolute colours (score quality). */
function verdictColor(cls: string): string {
  if (cls === "good") return C.teal;
  if (cls === "warn") return C.orange;
  return C.slate;
}

/** One verdict vocabulary, shared with the dashboard's Subject snapshot. */
function verdictOf(student: number | null, cls: number | null) {
  const { verdict } = compareToClassAverage(student, cls);
  if (verdict === "above") return { cls: "good", label: "Ahead of class" };
  if (verdict === "below") return { cls: "warn", label: "Needs attention" };
  if (verdict === "at_par") return { cls: "level", label: "About the same" };
  return { cls: "none", label: "No comparison" };
}

/**
 * Badge drawn as inline SVG rather than as text centred inside a styled box.
 *
 * html2canvas positions boxes from the real DOM layout but REDRAWS text itself
 * with its own baseline maths, so a glyph centred in a small box drifts (the
 * section numbers and the school mark sat low and off-centre in the PDF, while
 * the same markup looked correct in the browser). SVG is rasterised natively by
 * the browser and drawn as an image, which is why the charts have always come
 * out right - so the badges use the same route. dominant-baseline="central"
 * does the vertical centring exactly.
 */
function svgBadge(
  label: string,
  o: { size: number; radius: number; bg: string; fg: string; fontSize: number },
): string {
  return `<svg class="bsvg" width="${o.size}" height="${o.size}" viewBox="0 0 ${o.size} ${o.size}" xmlns="http://www.w3.org/2000/svg">` +
    `<rect width="${o.size}" height="${o.size}" rx="${o.radius}" fill="${o.bg}"/>` +
    `<text x="${o.size / 2}" y="${o.size / 2}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Inter, system-ui, Arial, sans-serif" font-size="${o.fontSize}" font-weight="700" fill="${o.fg}">${esc(label)}</text>` +
    `</svg>`;
}

/** Content column width in px: 210mm sheet less 15mm padding each side. */
const CONTENT_W = 680;

/**
 * A badge and its heading drawn as ONE svg.
 *
 * Aligning them as separate boxes never held up: html2canvas positions boxes
 * from the DOM but draws glyphs with its own baseline maths, so the badge sat
 * high however the boxes were centred (flex align-items, matched line-heights,
 * matched box heights - all correct in the browser, all wrong in the PDF).
 * Inside a single svg both the rect and the text are placed on the same
 * `dominant-baseline: central` axis, so their alignment is a coordinate, not a
 * layout outcome, and the rasteriser cannot disagree with it.
 */
function svgHeading(o: {
  badge: string;
  title: string;
  badgeSize: number;
  badgeRadius: number;
  badgeBg: string;
  badgeFg: string;
  badgeFont: number;
  titleSize: number;
  titleColor: string;
  titleShadow?: boolean;
  width?: number;
}): string {
  const h = Math.max(o.badgeSize, o.titleSize + 8);
  const mid = h / 2;
  const w = o.width ?? CONTENT_W;
  const gap = 9;
  const shadow = o.titleShadow
    ? `<filter id="hs" x="-20%" y="-40%" width="140%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="2.5" flood-color="#0c1a1c" flood-opacity="0.7"/></filter>`
    : "";
  return `<svg class="svg-head" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">` +
    (shadow ? `<defs>${shadow}</defs>` : "") +
    `<rect x="0" y="${mid - o.badgeSize / 2}" width="${o.badgeSize}" height="${o.badgeSize}" rx="${o.badgeRadius}" fill="${o.badgeBg}"/>` +
    `<text x="${o.badgeSize / 2}" y="${mid}" text-anchor="middle" dominant-baseline="central" ` +
    `font-family="Inter, system-ui, Arial, sans-serif" font-size="${o.badgeFont}" font-weight="700" fill="${o.badgeFg}">${esc(o.badge)}</text>` +
    `<text x="${o.badgeSize + gap}" y="${mid}" dominant-baseline="central" ${o.titleShadow ? 'filter="url(#hs)" ' : ""}` +
    `font-family="Inter, system-ui, Arial, sans-serif" font-size="${o.titleSize}" font-weight="800" ` +
    `letter-spacing="-0.1" fill="${o.titleColor}">${esc(o.title)}</text>` +
    `</svg>`;
}

function meter(value: number, showVal = true, color?: string): string {
  return `<span class="meter"><span class="meter-track"><span class="meter-fill" style="width:${Math.max(0, Math.min(100, value))}%;background:${color ?? barColor(value)};"></span></span>${
    showVal ? `<span class="meter-val">${Math.round(value)}%</span>` : ""
  }</span>`;
}

/* ------------------------------- charts ------------------------------- */

function trendChart(series: YearReportExam[]): string {
  if (series.length === 0) return "";
  const w = 640;
  const h = 208;
  const m = { top: 12, right: 46, bottom: 30, left: 32 };
  const n = Math.max(series.length - 1, 1);
  const x = (i: number) => m.left + (i / n) * (w - m.left - m.right);
  const y = (v: number) => h - m.bottom - (v / 100) * (h - m.bottom - m.top);

  const grid = [0, 25, 50, 75, 100]
    .map(
      (v) =>
        `<line x1="${m.left}" x2="${w - m.right}" y1="${y(v)}" y2="${y(v)}" stroke="${C.line}" stroke-width="1"/>` +
        `<text x="${m.left - 8}" y="${y(v) + 3}" text-anchor="end" font-size="9" fill="${C.muted}">${v}</text>`,
    )
    .join("");

  const step = Math.max(1, Math.ceil(series.length / 7));
  const labels = series
    .map((s, i) =>
      i % step === 0 || i === series.length - 1
        ? `<text x="${x(i)}" y="${h - 14}" text-anchor="middle" font-size="8" fill="${C.muted}">${esc(d(s.exam_date, "d MMM"))}</text>`
        : "",
    )
    .join("");

  const mine = series.map((s, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(s.my_pct)}`).join(" ");

  // Separate subpath per run of measured points: a suppressed class average
  // must leave a gap, not a line drawn straight across it.
  const segs: string[] = [];
  let run: string[] = [];
  series.forEach((s, i) => {
    if (s.class_avg == null) {
      if (run.length > 1) segs.push(run.join(" "));
      run = [];
      return;
    }
    run.push(`${run.length === 0 ? "M" : "L"}${x(i)},${y(s.class_avg)}`);
  });
  if (run.length > 1) segs.push(run.join(" "));
  const clsPath = segs
    .map(
      (dd) =>
        `<path d="${dd}" fill="none" stroke="${C.slate}" stroke-width="1.7" stroke-dasharray="4,3"/>`,
    )
    .join("");

  const dots = series
    .map(
      (s, i) =>
        (s.class_avg != null
          ? `<circle cx="${x(i)}" cy="${y(s.class_avg)}" r="2.6" fill="${C.slate}"/>`
          : "") +
        `<circle cx="${x(i)}" cy="${y(s.my_pct)}" r="3.8" fill="#fff" stroke="${C.teal}" stroke-width="2"/>`,
    )
    .join("");

  const last = series[series.length - 1];

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    ${grid}${labels}
    ${series.length > 1 ? `${clsPath}<path d="${mine}" fill="none" stroke="${C.teal}" stroke-width="2.2"/>` : ""}
    ${dots}
    <text x="${x(series.length - 1) + 8}" y="${y(last.my_pct) + 3}" font-size="11" font-weight="700" fill="${C.tealInk}">${Math.round(last.my_pct)}%</text>
  </svg>`;
}

function distChart(bins: { bin: string; count: number }[], myAvg: number | null): string {
  const w = 640;
  const h = 158;
  const m = { top: 32, right: 10, bottom: 28, left: 10 };
  const max = Math.max(...bins.map((b) => b.count), 1);
  const bandW = (w - m.left - m.right) / bins.length;
  const base = h - m.bottom;

  const myBin =
    myAvg == null
      ? -1
      : myAvg < 50
        ? 0
        : myAvg < 60
          ? 1
          : myAvg < 70
            ? 2
            : myAvg < 80
              ? 3
              : myAvg < 90
                ? 4
                : 5;

  const bars = bins
    .map((b, i) => {
      const bx = m.left + i * bandW + 11;
      const bw = bandW - 22;
      const isMe = i === myBin;
      // A count of 1 beside a count of 7 would otherwise be invisible.
      const bh = b.count === 0 ? 0 : Math.max(((base - m.top) * b.count) / max, 5);
      const by = base - bh;
      return (
        (b.count === 0
          ? `<line x1="${bx}" x2="${bx + bw}" y1="${base}" y2="${base}" stroke="#d8dce0" stroke-width="2"/>`
          : `<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" rx="2" fill="${isMe ? C.teal : "#d3d8dd"}"/>`) +
        `<text x="${bx + bw / 2}" y="${h - 9}" text-anchor="middle" font-size="9" fill="${C.muted}">${esc(b.bin)}%</text>` +
        `<text x="${bx + bw / 2}" y="${by - 6}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${isMe ? C.tealInk : C.muted}">${b.count}</text>` +
        (isMe
          ? `<text x="${bx + bw / 2}" y="13" text-anchor="middle" font-size="9" font-weight="700" fill="${C.tealInk}">You are here</text>`
          : "")
      );
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}">
    <line x1="${m.left}" x2="${w - m.right}" y1="${base}" y2="${base}" stroke="${C.line}" stroke-width="1"/>
    ${bars}
  </svg>`;
}

/* ------------------------------ narrative ------------------------------ */

function buildNarrative(r: YearReport, name: string): string {
  const s = r.snapshot;
  if (s.n_assessments === 0) {
    return "No published results fall inside this reporting period yet, so there is nothing to summarise.";
  }
  const first = esc(name.split(/\s+/)[0] || "This student");
  const parts: string[] = [
    `${first} has ${s.n_assessments} published ${s.n_assessments === 1 ? "assessment" : "assessments"} in this period, averaging <b>${pct(s.my_avg)}</b>`,
  ];
  if (s.class_avg != null) {
    const v = compareToClassAverage(s.my_avg, s.class_avg).verdict;
    const word = v === "at_par" ? "in line with" : v === "above" ? "above" : "below";
    parts.push(`which is ${word} the class average of <b>${pct(s.class_avg)}</b>`);
  }
  const weak = r.subjects.filter((x) => verdictOf(x.student_avg, x.class_avg).cls === "warn");
  const tail =
    weak.length === 0
      ? "No subject is currently below the class average."
      : `${weak.length === 1 ? "One subject needs" : `${weak.length} subjects need`} attention: ${weak.map((x) => esc(x.subject)).join(", ")}. Each is broken down below.`;
  return `${parts.join(", ")}. ${tail}`;
}

function sectionHead(num: number, title: string, sub?: string): string {
  return `<div class="sec">${svgHeading({
    badge: String(num),
    title,
    badgeSize: 22,
    badgeRadius: 5,
    badgeBg: C.teal,
    badgeFg: "#fff",
    badgeFont: 12,
    titleSize: 16,
    titleColor: C.ink,
  })}</div>${sub ? `<p class="sec-s">${esc(sub)}</p>` : ""}`;
}

/* ------------------------------ document ------------------------------ */

export function buildStudentReportHtml(r: YearReport, h: ReportHeaderInfo): string {
  const s = r.snapshot;
  const st = r.standing;
  const periodLabel = r.meta.window_is_synthetic
    ? "Last 12 months"
    : (r.meta.academic_year ?? "Academic year");
  const classLine = [h.className, h.section].filter(Boolean).join(" - ");

  const avgCmp = compareToClassAverage(s.my_avg, s.class_avg);
  const avgGap = s.class_avg == null ? null : (s.my_avg ?? 0) - s.class_avg;
  const avgDelta =
    s.class_avg == null
      ? "Class average hidden, needs 3+ classmates"
      : avgCmp.verdict === "at_par"
        ? `In line with class (${pct(s.class_avg)})`
        : `${Math.abs(avgGap ?? 0).toFixed(1)} pp ${avgCmp.verdict === "above" ? "above" : "below"} class (${pct(s.class_avg)})`;

  const passLine =
    s.pass_unknown > 0
      ? `${s.pass_count} of ${s.n_assessments} passed, ${s.pass_unknown} without a pass mark`
      : `${s.pass_count} of ${s.n_assessments} assessments passed`;

  /* strengths (max 3) */
  const strengths: { name: string; kind: string; value: string; note: string }[] = [];
  r.subjects
    .filter((x) => verdictOf(x.student_avg, x.class_avg).cls === "good")
    .sort((a, b) => b.student_avg - a.student_avg)
    .slice(0, 2)
    .forEach((x) =>
      strengths.push({
        name: x.subject,
        kind: "Subject",
        value: pct(x.student_avg, 0),
        note:
          x.class_avg != null
            ? `${(x.student_avg - x.class_avg).toFixed(1)} points above the class average across ${x.n_tests} ${x.n_tests === 1 ? "test" : "tests"}.`
            : `Across ${x.n_tests} ${x.n_tests === 1 ? "test" : "tests"}.`,
      }),
    );
  [...r.chapters]
    .sort((a, b) => b.student_avg - a.student_avg)
    .slice(0, Math.max(0, 3 - strengths.length))
    .forEach((c, i) =>
      strengths.push({
        name: c.chapter,
        kind: c.subject ? `Chapter, ${c.subject}` : "Chapter",
        value: pct(c.student_avg, 0),
        note: `${i === 0 && strengths.length === 0 ? "Your strongest chapter so far" : "Among your strongest chapters"}, from ${c.n_tests} ${c.n_tests === 1 ? "test" : "tests"} covering it.`,
      }),
    );

  /* focus areas (max 3) */
  const focusAll = r.subjects
    .filter((x) => verdictOf(x.student_avg, x.class_avg).cls === "warn")
    .sort(
      (a, b) =>
        a.student_avg -
        (a.class_avg ?? a.student_avg) -
        (b.student_avg - (b.class_avg ?? b.student_avg)),
    );

  const focusCard = (f: YearReportSubject, i: number): { html: string; h: number } => {
    const chapters = r.chapters
      .filter((c) => c.subject === f.subject)
      .sort((a, b) => a.student_avg - b.student_avg)
      .slice(0, 2);
    const gap = f.class_avg == null ? null : f.student_avg - f.class_avg;
    const sev = gap != null && gap < -10 ? "crit" : "warn";
    const steps = chapters.length
      ? chapters
          .map(
            (c) =>
              `<li><span class="bl">•</span>Revise <b>${esc(c.chapter)}</b> and redo the questions from the ${c.n_tests === 1 ? "test" : "tests"} that covered it.</li>`,
          )
          .join("")
      : `<li><span class="bl">•</span>Ask the subject teacher which chapters these tests covered, then revise those first.</li>`;
    const html = `<div class="focus">
      <div class="focus-hd">
        ${svgHeading({
          badge: String(i + 1),
          title: f.subject,
          badgeSize: 23,
          badgeRadius: 11.5,
          badgeBg: sev === "crit" ? C.red : C.orange,
          badgeFg: "#fff",
          badgeFont: 12,
          titleSize: 14,
          titleColor: C.ink,
          // Sized to the title so the severity tag sits right beside it. A
          // fixed width would reserve dead space after short names like "Art".
          width: 38 + Math.ceil(f.subject.length * 14 * 0.62),
        })}
        <span class="tag ${sev}">${gap == null ? "Below expectation" : `${gap.toFixed(1)} pp below class`}</span>
        <span class="focus-meta">${f.n_tests} ${f.n_tests === 1 ? "test" : "tests"}</span>
      </div>
      <p class="focus-ev">Averaging <b>${pct(f.student_avg)}</b>${f.class_avg != null ? `, against a class average of <b>${pct(f.class_avg)}</b>` : ""}.${chapters.length ? " The weakest chapters within it:" : ""}</p>
      ${
        chapters.length
          ? `<table class="mini"><tbody>${chapters
              .map(
                (c) =>
                  `<tr><td class="mini-name">${esc(c.chapter)}</td><td class="mini-bar">${meter(c.student_avg)}</td></tr>`,
              )
              .join("")}</tbody></table>`
          : `<p class="hint">No chapters were tagged on these tests, so the gap cannot be narrowed to a chapter.</p>`
      }
      <div class="steps"><span class="steps-h">Next steps</span><ul>${steps}</ul></div>
    </div>`;
    // Frame (header row, evidence line, steps chrome, padding, margin) plus a
    // row per chapter meter and a line per next step.
    const height = 140 + (chapters.length ? chapters.length * 26 : 24) + Math.max(chapters.length, 1) * 22;
    return { html, h: height };
  };

  /* ------------------------- page one (fixed) ------------------------- */
  const page1Blocks: string[] = [];
  let p1Used = 0;
  const p1 = (html: string, height: number) => {
    page1Blocks.push(html);
    p1Used += height;
  };

  p1(
    `${sectionHead(1, "Executive snapshot", "The headline numbers. Everything after this explains them.")}
    <div class="tiles">
      <div class="tile"><span class="t-k">Overall average</span><span class="t-v">${pct(s.my_avg)}</span><span class="t-d ${avgCmp.verdict === "above" ? "up" : avgCmp.verdict === "below" ? "down" : ""}">${esc(avgDelta)}</span></div>
      <div class="tile"><span class="t-k">Assessments passed</span><span class="t-v">${s.n_assessments > 0 ? Math.round((s.pass_count / s.n_assessments) * 100) : 0}%</span><span class="t-d">${esc(passLine)}</span></div>
      <div class="tile"><span class="t-k">Class standing</span><span class="t-v">${st.ahead_of == null ? "N/A" : `${st.ahead_of} of ${st.peers}`}</span><span class="t-d">${st.ahead_of == null ? "Needs 5+ classmates" : "classmates you are ahead of"}</span></div>
      <div class="tile"><span class="t-k">Consistency</span><span class="t-v">${s.consistency == null ? "N/A" : `${s.consistency}<em>/100</em>`}</span><span class="t-d">${s.consistency == null ? "Needs 3+ assessments" : "higher is steadier"}</span></div>
    </div>`,
    SEC_HEAD_H + 170,
  );
  p1(`<div class="note"><b>In plain terms:</b> ${buildNarrative(r, h.studentName)}</div>`, 124);
  p1(
    `${sectionHead(2, "What is going well", "Starting here on purpose. This is what to build on.")}
    ${
      strengths.length === 0
        ? `<p class="hint">No subject is clearly ahead of the class yet. That is normal early in a year.</p>`
        : `<div class="cards">${strengths
            .map(
              (x) => `<div class="card">
                <div class="card-hd"><span class="card-t">${esc(x.name)}</span><span class="card-v">${esc(x.value)}</span></div>
                <span class="card-k">${esc(x.kind)}</span>
                <p class="card-n">${esc(x.note)}</p>
              </div>`,
            )
            .join("")}</div>`
    }`,
    SEC_HEAD_H + (strengths.length === 0 ? 26 : 180),
  );
  void p1Used; // budget is asserted by the render check, not enforced here

  const heroPage = `<section class="page page-hero">
    <div class="hero">
      ${h.coverDataUrl ? `<img src="${h.coverDataUrl}" alt=""/>` : `<div class="hero-flat"></div>`}
      <div class="hero-brand">
        ${
          h.logoDataUrl
            ? `<img class="hero-logo" src="${h.logoDataUrl}" alt=""/><span class="hero-school">${esc(h.schoolName)}</span>`
            : svgHeading({
                badge: initials(h.schoolName),
                title: h.schoolName,
                badgeSize: 34,
                badgeRadius: 7,
                badgeBg: "rgba(255,255,255,0.94)",
                badgeFg: C.tealInk,
                badgeFont: 13,
                titleSize: 15,
                titleColor: "#ffffff",
                titleShadow: true,
                width: 420,
              })
        }
      </div>
      <div class="hero-title">
        <span class="hero-plate">
          <span class="hero-kicker">Academic Progress Report</span>
          <span class="hero-h1">${esc(periodLabel)}</span>
          <span class="hero-period">${esc(d(r.meta.from))} to ${esc(d(r.meta.to))} · ${s.n_assessments} ${s.n_assessments === 1 ? "assessment" : "assessments"} included</span>
        </span>
      </div>
    </div>
    <div class="hero-body">
      <div class="idcard">
        ${svgBadge(initials(h.studentName), { size: 56, radius: 28, bg: C.teal, fg: "#fff", fontSize: 20 })}
        <div class="idcard-main">
          <p class="idcard-name">${esc(h.studentName)}</p>
          <div class="idcard-rows">
            ${classLine ? `<div><span class="k">Class</span><span class="v">${esc(classLine)}</span></div>` : ""}
            ${h.rollNumber ? `<div><span class="k">Roll no.</span><span class="v">${esc(h.rollNumber)}</span></div>` : ""}
            ${h.admissionNumber ? `<div><span class="k">Admission no.</span><span class="v">${esc(h.admissionNumber)}</span></div>` : ""}
            <div><span class="k">Assessments</span><span class="v">${s.n_assessments}</span></div>
            ${st.peers != null ? `<div><span class="k">Classmates compared</span><span class="v">${st.peers}</span></div>` : ""}
          </div>
        </div>
      </div>
      ${page1Blocks.join("")}
    </div>
  </section>`;

  /* --------------- pages two onward, retried until they fit --------------- */
  const disclosure = [
    `Generated ${d(r.meta.generated_at.slice(0, 10))} for ${esc(periodLabel)}, ${d(r.meta.from)} to ${d(r.meta.to)}.`,
    `Based on ${r.coverage.n_results} published ${r.coverage.n_results === 1 ? "result" : "results"}.`,
    r.coverage.n_no_chapter > 0
      ? `${r.coverage.n_no_chapter} ${r.coverage.n_no_chapter === 1 ? "test has" : "tests have"} no chapter tagged and are absent from the chapter section.`
      : "",
    "Class comparisons use classmates with published results in the same section, and are hidden where fewer than 3 classmates contributed, or 5 for the class spread and the highest score.",
    "Results published after this date are not included.",
  ]
    .filter(Boolean)
    .join(" ");

  const chapterRowsAll = [...r.chapters].sort((a, b) => a.student_avg - b.student_avg);

  const assemble = (focusCap: number, chapterCap: number, logCap: number): string[][] => {
    const focus = focusAll.slice(0, focusCap);
    const pk = new Packer();

    // 3 - focus areas
    if (focus.length === 0) {
      pk.push(
        `${sectionHead(3, "Where support is needed", "Each issue is paired with a concrete next step.")}
        <div class="ok">No subject is below the class average in this period. Nothing is flagged.</div>`,
        SEC_HEAD_H + 64,
      );
    } else {
      focus.forEach((f, i) => {
        const card = focusCard(f, i);
        if (i === 0) {
          pk.push(
            `${sectionHead(3, "Where support is needed", "Each issue is paired with a concrete next step, worst gap first.")}${card.html}`,
            SEC_HEAD_H + card.h,
          );
        } else {
          pk.push(card.html, card.h);
        }
      });
      if (focusAll.length > focus.length) {
        pk.push(
          `<p class="hint">Only the ${focus.length} widest gaps are shown. ${focusAll.length - focus.length} more ${focusAll.length - focus.length === 1 ? "subject sits" : "subjects sit"} just below the class average, see the subject table.</p>`,
          24,
        );
      }
    }

    // 4 - trend and class standing
    pk.push(
      `${sectionHead(4, "Performance trend", s.n_assessments < 3 ? `Only ${s.n_assessments} ${s.n_assessments === 1 ? "assessment" : "assessments"} so far. A trend becomes meaningful after 3.` : "Every assessment in this period, in order, against the class average on the same test.")}
      <div class="legend"><span><i style="background:${C.teal}"></i>You</span><span><i class="dash" style="background:${C.slate}"></i>Class average</span></div>
      ${trendChart(r.series)}`,
      SEC_HEAD_H + 24 + 214,
    );
    if (st.histogram) {
      pk.push(
        `<div class="pair">
          <div class="stat"><span class="t-k">Class standing</span><span class="t-v sm">Ahead of ${st.ahead_of} of ${st.peers}</span><span class="t-d">classmates with published results in this section</span></div>
          <div class="stat accent"><span class="t-k">Highest average in class</span><span class="t-v sm">${pct(st.topper_avg)}</span><span class="t-d">${st.topper_avg != null && s.my_avg != null ? `${(st.topper_avg - s.my_avg).toFixed(1)} pp above your average` : ""}</span></div>
        </div>`,
        112,
      );
      pk.push(
        `<p class="sec-s" style="margin-top:12px">How the class is spread, and where you sit in it.</p>
        ${distChart(st.histogram, s.my_avg)}`,
        26 + 166,
      );
    } else {
      pk.push(
        `<p class="hint">Class spread and the highest score are hidden: fewer than 5 classmates have published results in this section.</p>`,
        28,
      );
    }

    // 5 - subjects
    if (r.subjects.length === 0) {
      pk.push(
        `${sectionHead(5, "Subject-wise performance")}<p class="hint">No subject-tagged results in this period.</p>`,
        SEC_HEAD_BARE_H + 26,
      );
    } else {
      const subjectRows = r.subjects.map((x) => {
        const v = verdictOf(x.student_avg, x.class_avg);
        const gap = x.class_avg == null ? null : x.student_avg - x.class_avg;
        return `<tr>
          <td>${esc(x.subject)}</td>
          <td class="meter-cell">${meter(x.student_avg, true, verdictColor(v.cls))}</td>
          <td class="n dim">${pct(x.class_avg)}</td>
          <td class="n ${gap == null ? "dim" : gap >= 0 ? "pos" : "neg"}">${gap == null ? "N/A" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`}</td>
          <td class="n dim">${x.n_tests}</td>
          <td><span class="tag ${v.cls}">${v.label}</span></td>
        </tr>`;
      });
      pk.push(
        `${sectionHead(5, "Subject-wise performance", "Every subject with data in this period, worst gap first. The bar is your average; the colour matches the status.")}
        <table class="rt">
          <thead><tr><th style="width:22%">Subject</th><th style="width:30%">You</th><th class="n">Class</th><th class="n">Gap</th><th class="n">Tests</th><th>Status</th></tr></thead>
          <tbody>${subjectRows.join("")}</tbody>
        </table>`,
        SEC_HEAD_H + TABLE_HEAD_H + subjectRows.length * SUBJECT_ROW_H + 16,
      );
    }

    // 6 - chapters
    const chapterShown = chapterRowsAll.slice(0, chapterCap);
    const chapterNote =
      chapterRowsAll.length > chapterShown.length
        ? `Showing the ${chapterShown.length} lowest-scoring chapters of ${chapterRowsAll.length}.`
        : "";
    if (chapterRowsAll.length === 0) {
      pk.push(
        `${sectionHead(6, "Chapter coverage")}<p class="hint">No chapters were tagged on the tests in this period.</p>`,
        SEC_HEAD_BARE_H + 26,
      );
    } else {
      pk.push(
        `${sectionHead(6, "Chapter coverage", "How you scored on the tests that covered each chapter, weakest first. A test covering three chapters counts towards all three.")}
        <table class="rt">
          <thead><tr><th style="width:20%">Subject</th><th style="width:32%">Chapter</th><th style="width:28%">Your score</th><th class="n">Class</th><th class="n">Tests</th></tr></thead>
          <tbody>${chapterShown
            .map(
              (c: YearReportChapter) => `<tr>
                <td class="dim">${esc(c.subject ?? "")}</td>
                <td>${esc(c.chapter)}</td>
                <td class="meter-cell">${meter(c.student_avg)}</td>
                <td class="n dim">${pct(c.class_avg)}</td>
                <td class="n dim">${c.n_tests}</td>
              </tr>`,
            )
            .join("")}</tbody>
        </table>${chapterNote ? `<p class="hint">${esc(chapterNote)}</p>` : ""}`,
        SEC_HEAD_H + 16 + TABLE_HEAD_H + chapterShown.length * DETAIL_ROW_H + (chapterNote ? 22 : 0) + 16,
      );
    }

    // 7 - assessment log. Latest tests matter most when truncating; series is
    // ASC so take the tail.
    const logShown = r.series.slice(-logCap);
    const logNote =
      r.series.length > logShown.length
        ? `Showing the latest ${logShown.length} of ${r.series.length} assessments. All ${r.series.length} are counted in every average above.`
        : "";
    if (r.series.length === 0) {
      pk.push(
        `${sectionHead(7, "Assessment log")}<p class="hint">No published results in this period.</p>`,
        SEC_HEAD_BARE_H + 26,
      );
    } else {
      pk.push(
        `${sectionHead(7, "Assessment log", "Every assessment in this report, in order.")}
        <table class="rt">
          <thead><tr><th>Assessment</th><th>Date</th><th class="n">You</th><th class="n">Marks</th><th class="n">Class</th><th class="n">Gap</th></tr></thead>
          <tbody>${logShown
            .map((e) => {
              const gap = e.class_avg == null ? null : e.my_pct - e.class_avg;
              return `<tr>
                <td class="clip">${esc(e.title)}</td>
                <td class="dim">${esc(d(e.exam_date, "d MMM yy"))}</td>
                <td class="n">${pct(e.my_pct)}</td>
                <td class="n dim">${e.obtained != null && e.out_of != null ? `${e.obtained}/${e.out_of}` : "N/A"}</td>
                <td class="n dim">${pct(e.class_avg)}</td>
                <td class="n ${gap == null ? "dim" : gap >= 0 ? "pos" : "neg"}">${gap == null ? "N/A" : `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`}</td>
              </tr>`;
            })
            .join("")}</tbody>
        </table>${logNote ? `<p class="hint">${esc(logNote)}</p>` : ""}`,
        SEC_HEAD_H + TABLE_HEAD_H + logShown.length * DETAIL_ROW_H + (logNote ? 22 : 0) + 16,
      );
    }

    // 8 - recognition, attendance, disclosure
    pk.push(
      `${sectionHead(8, "Recognition and attendance")}
      <div class="pair">
        <div class="stat teal">
          <span class="t-k">Achievements</span>
          <span class="t-v sm">${r.engagement.points} points</span>
          <span class="t-d">${r.engagement.badge_count} ${r.engagement.badge_count === 1 ? "badge" : "badges"} earned${
            r.engagement.badges.length
              ? ` · ${r.engagement.badges
                  .slice(0, 4)
                  .map((b) => esc(b.name))
                  .join(", ")}${r.engagement.badge_count > 4 ? ` +${r.engagement.badge_count - 4} more` : ""}`
              : ""
          }</span>
        </div>
        <div class="stat">
          <span class="t-k">Attendance in this period</span>
          <span class="t-v sm">${pct(r.attendance.percentage)}</span>
          <span class="t-d">${r.attendance.graded_days > 0 ? `Present ${r.attendance.present} of ${r.attendance.graded_days} marked days` : "No attendance marked"}</span>
        </div>
      </div>`,
      SEC_HEAD_BARE_H + 118,
    );
    pk.push(
      `<div class="disclosure"><span class="disc-h">How to read this report</span><p>${disclosure}</p></div>`,
      118,
    );
    pk.flush();
    return pk.pages;
  };

  // Page one plus three packed sheets = four pages. Walk the ladder until that
  // holds; the last rung always fits.
  let packed = assemble(CAP_LADDER[0][0], CAP_LADDER[0][1], CAP_LADDER[0][2]);
  for (const [fc, cc, lc] of CAP_LADDER) {
    packed = assemble(fc, cc, lc);
    if (packed.length <= 3) break;
  }

  const pages = [
    heroPage,
    ...packed.map((blocks) => `<section class="page"><div class="rule"></div>${blocks.join("")}</section>`),
  ];
  const total = pages.length;
  const numbered = pages
    .map((p, i) =>
      // Replacer FUNCTION, not string: a "$&"-style sequence inside a student
      // name would otherwise be expanded by String.replace.
      p.replace(
        "</section>",
        () =>
          `<footer class="pg"><span><b class="pg-brand">SALCI</b> · ${esc(h.studentName)} · ${esc(periodLabel)}</span><span>Page ${i + 1} of ${total}</span></footer></section>`,
      ),
    )
    .join("");

  return `<div id="salci-report">
  <style>
    #salci-report * { box-sizing: border-box; margin: 0; padding: 0; }
    #salci-report { font-family: Inter, system-ui, -apple-system, "Segoe UI", Arial, sans-serif; color: ${C.ink}; -webkit-font-smoothing: antialiased; }

    /* Fixed A4 sheets; the download path rasterises each to its own PDF page. */
    #salci-report .page {
      width: 210mm; height: 297mm; padding: 15mm 15mm 17mm; background: #fff;
      position: relative; overflow: hidden;
    }
    #salci-report .page.page-hero { padding: 0 0 17mm; }
    #salci-report .hero-body { padding: 0 15mm; }
    #salci-report .pg {
      position: absolute; left: 15mm; right: 15mm; bottom: 7mm;
      display: flex; justify-content: space-between;
      font-size: 8.5px; color: ${C.muted}; border-top: 1px solid ${C.line}; padding-top: 6px;
    }
    #salci-report .pg-brand { color: ${C.teal}; font-weight: 800; letter-spacing: .06em; }
    #salci-report .rule { position: absolute; top: 0; left: 0; right: 0; height: 5px; background: ${C.teal}; }

    /* ---- hero band (page one), per the reference mockup ---- */
    #salci-report .hero { position: relative; height: 102mm; overflow: hidden; }
    #salci-report .hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #salci-report .hero-flat { width: 100%; height: 100%; background: ${C.teal}; }
    #salci-report .hero-brand { position: absolute; top: 11mm; left: 15mm; display: flex; align-items: center; gap: 10px; }
    /* Badges are inline SVG (see svgBadge): html2canvas mis-centres text drawn
       inside a styled box, but rasterises SVG natively and correctly. */
    #salci-report .bsvg, #salci-report .svg-head { display: block; flex: none; }
    #salci-report .hero-logo { width: 34px; height: 34px; border-radius: 7px; object-fit: contain; background: #fff; }
    #salci-report .hero-school { color: #fff; font-size: 15px; font-weight: 700; line-height: 34px; height: 34px; text-shadow: 0 1px 6px rgba(12,26,28,0.75); }
    /* Clears the ID card, which overlaps 13mm into the hero: at bottom:13mm the
       period line rendered underneath the card. */
    #salci-report .hero-title { position: absolute; left: 15mm; right: 15mm; bottom: 24mm; text-align: left; }
    /* No plate and no scrim: the title sits directly on the artwork in DARK
       ink, because it is positioned over the pale sunrise-lake region of the
       cover where white type washed out. The soft white halo separates it from
       the busier detail without dulling the illustration. */
    #salci-report .hero-plate { display: inline-block; }
    #salci-report .hero-kicker { display: block; font-size: 11px; letter-spacing: .2em; text-transform: uppercase; font-weight: 800; color: ${C.tealInk}; text-shadow: 0 1px 3px rgba(255,255,255,0.85); }
    #salci-report .hero-h1 { display: block; font-size: 40px; font-weight: 800; color: #10262a; margin-top: 5px; letter-spacing: -0.015em; line-height: 1.05; text-shadow: 0 2px 6px rgba(255,255,255,0.8); }
    #salci-report .hero-period { display: block; font-size: 12.5px; font-weight: 600; color: #24353a; margin-top: 7px; text-shadow: 0 1px 3px rgba(255,255,255,0.85); }

    #salci-report .idcard { display: flex; gap: 16px; align-items: flex-start; background: #fff; border: 1px solid ${C.line}; border-radius: 12px; padding: 18px 20px; margin-top: -13mm; position: relative; z-index: 2; box-shadow: 0 10px 26px rgba(20,30,32,0.15); }
    #salci-report .idcard-name { font-size: 19px; font-weight: 800; }
    #salci-report .idcard-rows { display: flex; flex-wrap: wrap; gap: 10px 30px; margin-top: 10px; }
    #salci-report .idcard-rows > div { display: flex; flex-direction: column; }
    #salci-report .idcard-rows .k { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; }
    #salci-report .idcard-rows .v { font-size: 13px; font-weight: 700; margin-top: 2px; }

    /* ---- section headings ---- */
    /* Badge and heading are given the SAME box height (22px) rather than relying
       on flex centring: html2canvas does not reproduce align-items:center for
       these, so equal heights make the alignment correct under either rule. */
    #salci-report .sec { display: flex; align-items: center; gap: 9px; margin: 26px 0 5px; }
    /* line-height 1 keeps the text box the same height as the 22px badge, so
       flex centring lines their optical centres up exactly. */
    #salci-report .sec-t { font-size: 16px; font-weight: 800; letter-spacing: -0.005em; line-height: 22px; height: 22px; }
    #salci-report .sec-s { font-size: 10.5px; color: ${C.muted}; margin-bottom: 13px; line-height: 1.5; }

    /* ---- tiles ---- */
    #salci-report .tiles { display: flex; gap: 10px; margin-bottom: 16px; }
    #salci-report .tile { flex: 1; border: 1px solid ${C.line}; border-radius: 9px; padding: 16px 16px; display: flex; flex-direction: column; }
    #salci-report .t-k { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; font-weight: 700; }
    #salci-report .t-v { font-size: 28px; font-weight: 800; margin-top: 6px; line-height: 1.1; }
    #salci-report .t-v.sm { font-size: 18px; }
    #salci-report .t-v em { font-size: 12px; font-style: normal; color: ${C.muted}; font-weight: 600; }
    #salci-report .t-d { font-size: 9.5px; color: ${C.muted}; margin-top: 7px; line-height: 1.4; }
    #salci-report .t-d.up { color: ${C.tealInk}; font-weight: 600; }
    #salci-report .t-d.down { color: ${C.orangeInk}; font-weight: 600; }

    #salci-report .note { border-left: 4px solid ${C.teal}; background: ${C.tealWash}; padding: 16px 18px; font-size: 12px; line-height: 1.65; color: ${C.ink2}; border-radius: 0 8px 8px 0; }
    #salci-report .note b { color: ${C.ink}; }
    #salci-report .hint { font-size: 10.5px; color: ${C.muted}; font-style: italic; margin-top: 7px; line-height: 1.5; }
    #salci-report .ok { border: 1px solid ${C.teal}; background: ${C.tealWash}; color: ${C.tealInk}; border-radius: 9px; padding: 14px 16px; font-size: 12px; font-weight: 700; }

    /* ---- strength cards ---- */
    #salci-report .cards { display: flex; gap: 10px; }
    #salci-report .cards .card { flex: 1; border: 1px solid ${C.line}; border-top: 3px solid ${C.teal}; border-radius: 9px; padding: 16px 16px; }
    #salci-report .card-hd { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    #salci-report .card-t { font-size: 12.5px; font-weight: 700; line-height: 1.3; }
    #salci-report .card-v { font-size: 19px; font-weight: 800; color: ${C.tealInk}; }
    #salci-report .card-k { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; display: block; margin-top: 3px; }
    #salci-report .card-n { font-size: 11px; color: ${C.ink2}; margin-top: 9px; line-height: 1.5; }

    /* ---- focus cards ---- */
    #salci-report .focus { border: 1px solid ${C.line}; border-radius: 9px; padding: 14px 16px; margin-bottom: 12px; }
    #salci-report .focus-hd { display: flex; align-items: center; gap: 9px; }
    #salci-report .focus-t { font-size: 14px; font-weight: 800; line-height: 23px; height: 23px; }
    #salci-report .focus-meta { margin-left: auto; font-size: 10px; color: ${C.muted}; }
    #salci-report .focus-ev { font-size: 11px; color: ${C.ink2}; margin: 9px 0 10px; line-height: 1.55; }
    #salci-report table.mini { width: 100%; border-collapse: collapse; }
    #salci-report table.mini td { padding: 4px 0; font-size: 10.5px; }
    #salci-report .mini-name { width: 55%; font-weight: 600; }
    #salci-report .mini-bar { width: 45%; padding-left: 14px !important; }
    #salci-report .steps { border-top: 1px solid ${C.line}; margin-top: 11px; padding-top: 10px; }
    #salci-report .steps-h { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${C.tealInk}; font-weight: 800; }
    /* Literal bullet glyphs: html2canvas never draws native list markers. */
    #salci-report .steps ul { margin: 7px 0 0 2px; list-style: none; }
    #salci-report .steps li { font-size: 10.5px; color: ${C.ink2}; line-height: 1.55; margin-bottom: 4px; }
    #salci-report .bl { color: ${C.teal}; font-weight: 800; margin-right: 7px; }

    /* Tags: fixed height + line-height, no vertical padding - html2canvas drew
       padded inline backgrounds floating above their text in table cells. */
    #salci-report .tag { display: inline-block; font-size: 9.5px; font-weight: 700; height: 19px; line-height: 19px; padding: 0 9px; border-radius: 4px; white-space: nowrap; vertical-align: middle; }
    #salci-report .tag.good { background: ${C.tealWash}; color: ${C.tealInk}; }
    #salci-report .tag.level { background: ${C.slateWash}; color: ${C.ink2}; }
    #salci-report .tag.none { background: ${C.slateWash}; color: ${C.muted}; }
    #salci-report .tag.warn { background: ${C.orangeWash}; color: ${C.orangeInk}; }
    #salci-report .tag.crit { background: ${C.redWash}; color: ${C.red}; }

    /* ---- meters ---- */
    #salci-report .meter { display: flex; align-items: center; gap: 9px; }
    #salci-report .meter-track { flex: 1; height: 7px; border-radius: 4px; background: ${C.track}; overflow: hidden; display: block; }
    #salci-report .meter-fill { height: 7px; border-radius: 4px; display: block; }
    #salci-report .meter-val { font-size: 10.5px; font-weight: 700; width: 34px; text-align: right; }
    #salci-report .meter-cell { padding-right: 18px !important; }

    /* ---- tables ---- */
    #salci-report table.rt { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    #salci-report table.rt th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .04em; color: ${C.ink2}; border-bottom: 1.5px solid ${C.ink}; padding: 7px; font-weight: 800; }
    #salci-report table.rt td { padding: 10px 7px; border-bottom: 1px solid ${C.line}; vertical-align: middle; }
    #salci-report td.clip { max-width: 230px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #salci-report .n { text-align: right; }
    #salci-report .dim { color: ${C.muted}; }
    #salci-report .pos { color: ${C.tealInk}; font-weight: 700; }
    #salci-report .neg { color: ${C.orangeInk}; font-weight: 700; }

    /* ---- misc ---- */
    #salci-report .legend { display: flex; gap: 18px; font-size: 10px; color: ${C.ink2}; margin-bottom: 8px; }
    #salci-report .legend i { display: inline-block; width: 16px; height: 3px; border-radius: 2px; margin-right: 6px; vertical-align: middle; }
    #salci-report .pair { display: flex; gap: 12px; margin-top: 16px; }
    #salci-report .stat { flex: 1; border: 1px solid ${C.line}; border-left: 4px solid ${C.slate}; border-radius: 0 9px 9px 0; padding: 13px 15px; display: flex; flex-direction: column; }
    #salci-report .stat.accent { border-left-color: ${C.orange}; }
    #salci-report .stat.teal { border-left-color: ${C.teal}; }
    #salci-report .disclosure { margin-top: 20px; border-top: 1px solid ${C.line}; padding-top: 11px; }
    #salci-report .disc-h { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: ${C.muted}; font-weight: 800; }
    #salci-report .disclosure p { font-size: 9.5px; color: ${C.muted}; line-height: 1.65; margin-top: 6px; }
  </style>
  ${numbered}
</div>`;
}
