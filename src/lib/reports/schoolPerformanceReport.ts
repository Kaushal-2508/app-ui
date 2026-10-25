/**
 * The School Performance Report: four A4 pages, built from one RPC.
 *
 * This is a port of public/report_reference/school-performance-report.html,
 * which is the report's specification. The stylesheet is that file's verbatim;
 * the renderer follows it page for page, table for table. Two deliberate
 * departures, both of which leave the printed page identical:
 *
 *  1. Rows the report never prints are not shipped. The reference holds every
 *     subject-class pair and every absentee in memory so it can call .length
 *     on them; dash5_report_snapshot counts them in Postgres instead
 *     (CLAUDE.md 23: never fetch rows to count them). Payload at Alliance:
 *     42 KB instead of roughly 700.
 *  2. No em-dashes (CLAUDE.md UI/UX). The reference prints an em-dash for a
 *     missing value and inside two asides; here a missing value reads "N/A"
 *     and the asides are recast with commas.
 *
 * The numbers come from the same dash5_* functions the dashboard draws, so a
 * figure in the PDF is the figure the principal just looked at.
 */

/* --------------------------------------------------------------- types --- */

/** Per-wing student roll-up, as dash5_student_tree returns it. */
export interface ReportStu {
  students?: number;
  adopt_pct?: number | null;
  score_pct?: number | null;
  homework_pct?: number | null;
  attendance_pct?: number | null;
  submission_pct?: number | null;
  at_risk?: number;
  never_in?: number;
}

export interface ReportClass {
  id: string;
  code: string;
  teacherName: string;
  students: number;
  attendance: number | null;
  syllabus: number | null;
  chapters: number;
  chaptersDone: number;
  chaptersPartial: number;
  papers: number;
  accuracy: number | null;
  band: string | null;
}

export interface ReportUnit {
  students: number;
  classCount: number;
  subjectPairs: number;
  subjectCount: number;
  attendance: number | null;
  syllabus: number | null;
  lessonsTaught: number;
  lessonsPlanned: number;
  lessonPct: number | null;
  papers: number;
  papersPlanned: number;
  papersPublished: number;
  pendingGrading: number;
  papersScheduled: number;
  papersDraft: number;
  wkDone: number;
  wkPlanned: number;
  accuracy: number | null;
  attempts: number;
  homework: number | null;
  chapters: number;
  chaptersDone: number;
  chaptersPartial: number;
  band: string | null;
}

export interface ReportWing extends ReportUnit {
  id: string;
  name: string;
  span: string;
  head: string;
  stu: ReportStu;
  classes: ReportClass[];
}

export interface ReportTeacher {
  name: string;
  wingId: string | null;
  classes: number;
  subjects: string;
  tests: number;
  hwGiven: number;
  lessons: number;
  avgScore: number | null;
  /** Null when the teacher has never signed in. */
  lastSeen: number | null;
  level: string;
}

export interface ReportSubject {
  name: string;
  attempts: number;
  papers: number;
  classes: number;
  acc: number | null;
  cov: number | null;
}

export interface ReportAtRiskRow {
  name: string;
  cls: string;
  wingId: string | null;
  roll: string | null;
  classTeacher: string;
  score: number | null;
  attendance: number | null;
  homework: number | null;
  submission: number | null;
  neverIn: boolean;
  riskScore: number | null;
  band: string | null;
}

/* The three RPC payloads, as dash5_report_core / _students / _attendance
   return them. They are split for the 8s statement_timeout, not because the
   report thinks of its data in three parts, so the hook merges them back into
   one ReportSnapshot before anything renders. */
export interface ReportCore {
  meta: { school: string; year: string; asOf: string; yearGone: number; attDays: number };
  school: ReportUnit & { pairsNoPaper: number };
  wings: Omit<ReportWing, "stu">[];
  subjRollup: ReportSubject[];
  teachers: ReportTeacher[];
}

export interface ReportStudents {
  schoolStu: ReportStu;
  /** Keyed by wing id; the hook stitches each onto its wing. */
  wingStu: Record<string, ReportStu>;
  bands: { band: string; n: number; pct: number | null }[];
  atRisk: { total: number; byWing: Record<string, number>; rows: ReportAtRiskRow[] };
}

export interface ReportAttendance {
  neverTotal: number;
  neverByWing: Record<string, number>;
  absentees: { total: number; streak: number; byWing: Record<string, number> };
}

export interface ReportSnapshot {
  meta: {
    school: string;
    year: string;
    asOf: string;
    yearGone: number;
    attDays: number;
    neverTotal: number;
    neverByWing: Record<string, number>;
  };
  school: ReportUnit & { pairsNoPaper: number };
  schoolStu: ReportStu;
  wings: ReportWing[];
  subjRollup: ReportSubject[];
  teachers: ReportTeacher[];
  atRisk: { total: number; byWing: Record<string, number>; rows: ReportAtRiskRow[] };
  absentees: { total: number; streak: number; byWing: Record<string, number> };
  /** How the roll splits across the four score bands, school and per wing. */
  bands: { band: string; n: number; pct: number | null }[];
}

/** The only block a school edits, as in the reference. */
export interface ReportConfig {
  labels: { tier1: string; tier1Plural: string; tier2: string; tier2Plural: string; tier3: string };
  attendanceFloor: number;
  bandLabels: Record<string, string>;
  riskWeights: string;
  engagementLevels: Record<string, string>;
  minimalLevel: string;
  streakAlert: number;
  listCap: number;
  /**
   * Rows each capped list prints. These are the page budget: the reference
   * says to lower a cap rather than loosen the stylesheet if a build spills
   * onto a fifth page. Every one is set to what fills its page at A4 with
   * Alliance's 53 classes and 90 teachers, measured in a browser, and every
   * table states how many rows it withheld.
   */
  caps: { subjects: number; classes: number; quietTeachers: number; atRisk: number };
  roles: { prepared: string; reviewed: string };
}

export const DEFAULT_REPORT_CONFIG: ReportConfig = {
  labels: {
    tier1: "Wing",
    tier1Plural: "Wings",
    tier2: "Class",
    tier2Plural: "Classes",
    tier3: "Subject",
  },
  attendanceFloor: 75,
  bandLabels: { exc: "Excellent", good: "Good", watch: "Watch", att: "Attention" },
  riskWeights: "0.5 x average score + 0.3 x attendance + 0.2 x homework",
  engagementLevels: { Minimal: "Minimal", Moderate: "Moderate", Strong: "Strong" },
  minimalLevel: "Minimal",
  streakAlert: 3,
  listCap: 10,
  /* The caps are the STATIC layout, which is what the native PDF path gets:
     html2pdf runs no script, so these have to fit A4 on their own. In a
     browser the paginator treats them as a floor and grows each table into
     whatever room its page actually has. */
  caps: { subjects: 7, classes: 14, quietTeachers: 8, atRisk: 10 },
  roles: { prepared: "Super School Admin", reviewed: "Principal" },
};

const STYLE = `
/* SALCI's own palette, resolved to hex because a print window has none of the
   app's CSS variables. --brand is the teal at print weight (#249ca2 lightened
   type on paper reads grey); the four band colours are the dashboard's
   --dash-exc / --dash-good / --dash-warning / --dash-critical pulled down for
   ink, so a band means the same thing on the page as it does on the screen. */
:root {
  --ink:     #0F1729;
  --ink-2:   #4A5262;
  --ink-3:   #858B99;
  --rule:    #CBD2DA;
  --rule-2:  #E7EAEF;
  --band:    #EEF5F5;
  --band-2:  #F8FBFB;
  --zebra:   #FBFCFD;
  --brand:   #1C7D82;
  --brand-2: #249CA2;
  --exc:     #0B7A33;
  --good:    #1F7A5C;
  --watch:   #A55F09;
  --att:     #B81E1E;
}
@page { size: A4 portrait; margin: 0; }

* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { margin: 0; background: #fff; color: var(--ink);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 9pt; line-height: 1.36; }

@media screen {
  body { background: #E7EAEF; padding: 16px 0 40px; }
  .pg { margin: 0 auto 16px; box-shadow: 0 2px 12px rgba(15,23,41,.16); }
}
/* Exactly one sheet: a fixed box, its own gutter, nothing from @page.
   overflow:hidden is a backstop only, the paginator fits content to 270mm. */
.pg { background: #fff; width: 210mm; height: 297mm; padding: 13mm 13mm 14mm;
  position: relative; display: flow-root; overflow: hidden; }
@media print { .pg { break-after: page; } .pg:last-child { break-after: auto; } }
/* A block is the unit the paginator moves; it never splits one across pages. */
.blk { break-inside: avoid; }

h1 { font-size: 19pt; font-weight: 800; letter-spacing: -.035em; line-height: 1.05; margin: 0; }
h2 { font-size: 10.4pt; font-weight: 800; letter-spacing: -.02em; margin: 4mm 0 1.6mm;
     padding-bottom: 1.1mm; border-bottom: 1.3pt solid var(--brand); color: var(--ink); }
.blk:first-child h2 { margin-top: 0; }
p { margin: 0 0 1.6mm; }
.muted { color: var(--ink-3); }
.xs { font-size: 7.6pt; color: var(--ink-3); }

/* The masthead is a full-bleed SALCI teal band: it runs out to the paper's
   edge through negative margins that cancel the page gutter, and closes on a
   lilac hairline, which is the second brand colour. This is the one place the
   report is allowed to be loud, and it is what makes a printed sheet
   recognisable as SALCI's from across a table. */
.mast { margin: -13mm -13mm 4mm; padding: 10mm 13mm 6mm; background: var(--brand);
  color: #fff; border-bottom: 1.8mm solid var(--brand-2); }
.mast .row { display: flex; align-items: flex-end; gap: 6mm; }
.mast .id { flex: 1; }
.mast h1 { color: #fff; }
.mast .school { font-size: 10.5pt; font-weight: 750; color: rgba(255,255,255,.78);
  margin-bottom: 1.2mm; letter-spacing: .01em; text-transform: uppercase; font-size: 8pt; }
.mast .when { text-align: right; font-size: 8.2pt; color: rgba(255,255,255,.78); line-height: 1.5; }
.mast .when b { color: #fff; font-size: 9.4pt; }

/* The four the dashboard leads with, in the same order, so a reader who knows
   the screen recognises the paper. */
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2.4mm; margin-bottom: 3.4mm; }
.kpi { border: .6pt solid var(--rule-2); border-left: 2.6pt solid var(--brand-2);
  background: var(--band-2); padding: 2mm 2.6mm; }
.kpi .k { font-size: 6.6pt; font-weight: 800; letter-spacing: .08em; text-transform: uppercase;
  color: var(--ink-3); }
.kpi .v { font-size: 15pt; font-weight: 800; letter-spacing: -.035em; margin: .5mm 0 0;
  color: var(--ink); line-height: 1.05; }
.kpi .v small { font-size: 8.6pt; font-weight: 700; color: var(--ink-3); letter-spacing: 0; }
.kpi .s { font-size: 7pt; color: var(--ink-2); margin-top: .6mm; line-height: 1.3; }

.phead { display: flex; justify-content: space-between; align-items: baseline;
  border-bottom: .8pt solid var(--rule); padding-bottom: 1.2mm; margin-bottom: 3mm;
  font-size: 7.8pt; color: var(--ink-3); }
.phead b { color: var(--brand); font-size: 8.6pt; }
.phead b::before { content: ''; display: inline-block; width: 2.4mm; height: 2.4mm;
  background: var(--brand-2); border-radius: .5mm; margin-right: 1.6mm; vertical-align: -.1mm; }
/* Every page signs itself, so a loose sheet is still identifiable. */
.pfoot { position: absolute; left: 13mm; right: 13mm; bottom: 6mm;
  display: flex; justify-content: space-between; font-size: 7pt; color: var(--ink-3);
  border-top: .5pt solid var(--rule-2); padding-top: 1.2mm; }

.verdict { border-left: 3pt solid var(--brand-2); background: var(--band-2);
  padding: 2.6mm 3.4mm; margin-bottom: 3mm; }
.pts { column-count: 2; column-gap: 7mm; list-style: none; margin: 0; padding: 0; }
.pts li { break-inside: avoid; position: relative; padding: .85mm 0 .85mm 4mm;
  font-size: 8.9pt; line-height: 1.3; color: var(--ink-2); }
.pts li::before { content: ''; position: absolute; left: 0; top: 2.4mm;
  width: 1.7mm; height: 1.7mm; border-radius: .4mm; background: var(--brand-2); }
.pts li b { color: var(--ink); font-weight: 750; }

table { width: 100%; border-collapse: collapse; margin: 0 0 2.4mm;
  font-variant-numeric: tabular-nums; font-size: 8.1pt; }
th, td { padding: 1.05mm 1.8mm; text-align: left; border-bottom: .5pt solid var(--rule-2); }
thead th { background: var(--band); border-bottom: 1pt solid var(--brand); border-top: .5pt solid var(--rule);
  font-size: 7.2pt; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--brand); }
tfoot td { background: var(--band-2); border-top: 1pt solid var(--brand); border-bottom: 1pt solid var(--brand);
  font-weight: 750; }
td.n, th.n { text-align: right; }
tbody tr:nth-child(even) td { background: var(--zebra); }
.nm { font-weight: 700; }
td { white-space: nowrap; }
td:first-child, td:last-child, td.w { white-space: normal; }
.sub { font-size: 7.2pt; color: var(--ink-3); font-weight: 500; }
.more td { background: #fff !important; font-size: 7.6pt; color: var(--ink-3); font-style: italic; }
/* Rows the paginator may reveal if the page has room. */
tr.x { display: none; }

.st { font-weight: 750; white-space: nowrap; }
.st-exc { color: var(--exc); } .st-good { color: var(--good); }
.st-watch { color: var(--watch); } .st-att { color: var(--att); }

/* band chip: colour plus the word, never colour alone */
.chip { display: inline-block; min-width: 2.6mm; height: 2.6mm; border-radius: .5mm;
  margin-right: 1.4mm; vertical-align: -.2mm; }

.read { font-size: 8pt; color: var(--ink-2); margin: 0 0 2mm; line-height: 1.38; }
.read b { color: var(--ink); }

.two { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; }

/* the share bar under the band table */
.bar { display: flex; height: 3.4mm; border-radius: .6mm; overflow: hidden; margin: 0 0 1.6mm; }
.bar span { display: block; }

.sign { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6mm; margin-top: 4mm;
  padding-top: 3mm; border-top: .8pt solid var(--rule); }
.sign div { font-size: 8pt; color: var(--ink-3); }
.sign div .line { border-bottom: .8pt solid var(--ink); height: 8mm; margin-bottom: 1.2mm; }
`;

/* -------------------------------------------------------------- render --- */

/** "N/A", not an em-dash: CLAUDE.md bans em-dashes in anything a person reads. */
const NA = "N/A";

type Num = number | null | undefined;

const r0 = (v: Num): string => (v == null ? NA : Math.round(v).toLocaleString("en-IN"));
const r1 = (v: Num): string => (v == null ? NA : (Math.round(v * 10) / 10).toFixed(1));
const pc0 = (v: Num): string => (v == null ? NA : `${Math.round(v)}%`);
const pc1 = (v: Num): string => (v == null ? NA : `${(Math.round(v * 10) / 10).toFixed(1)}%`);
const esc = (s: unknown): string =>
  String(s == null ? "" : s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
const plural = (n: number, s: string, p?: string): string => (n === 1 ? s : p ?? `${s}s`);

/** Truncate on a comma boundary so a subject list never breaks mid-word. */
function clip(str: string, max: number): string {
  const t = String(str);
  if (t.length <= max) return t;
  const cut = t.lastIndexOf(",", max);
  return `${cut > max * 0.4 ? t.slice(0, cut) : t.slice(0, max)}…`;
}

interface Head {
  t: string;
  n?: boolean;
}
const N = (t: string): Head => ({ t, n: true });
const H = (t: string): Head => ({ t });

interface TableOpts {
  /** Rows shown before the paginator is consulted. The rest ship hidden. */
  cap?: number;
  moreNote?: string;
  foot?: string[];
  /** false for a table with a fixed row set (chapter state, bands, wings). */
  grow?: boolean;
}

/**
 * The paginator, inlined into the printed document.
 *
 * The report is emitted as an ordered list of blocks already dealt into four
 * pages, which is what the native shell gets: html2pdf renders the HTML
 * string without running scripts, so the static layout has to stand on its
 * own. In a browser this then runs and does two things the builder cannot,
 * because neither can be known without measuring rendered text:
 *
 *   1. REPACK. Every block is re-dealt into pages, greedily, so a page is
 *      never left half empty because the builder guessed where to break.
 *   2. GROW. A capped table ships all of its rows, the surplus hidden. A page
 *      with room left reveals rows one at a time until the next would
 *      overflow, then rewrites its "N further rows not shown" line.
 *
 * It measures only after the webfont has loaded: Inter and the fallback do
 * not fit the same number of rows on a page.
 */
const PAGINATOR = `
(function () {
  var LIMIT = (297 - 13 - 14) * 96 / 25.4;   /* A4 height minus page margins */
  var PADTOP = 13 * 96 / 25.4;
  var FLOOR = 3;                             /* never shrink a table below this */

  function used(pg) {
    var kids = pg.querySelectorAll('.blk');
    if (!kids.length) return 0;
    return kids[kids.length - 1].getBoundingClientRect().bottom -
           (pg.getBoundingClientRect().top + PADTOP);
  }
  function over(pg) { return used(pg) > LIMIT; }

  function growables(scope) {
    return [].slice.call(scope.querySelectorAll('table[data-grow]'));
  }
  function shown(t) {
    return [].slice.call(t.querySelectorAll('tbody tr')).filter(function (r) {
      return !r.classList.contains('x') && !r.classList.contains('more');
    });
  }

  /* Hide rows from the bottom of this block's tables until the page fits.
     Returns true if it got there without going below the floor. */
  function shrink(pg, blk) {
    var tables = growables(blk);
    if (!tables.length) return false;
    var guard = 400;
    while (over(pg) && guard-- > 0) {
      var moved = false;
      for (var i = 0; i < tables.length; i++) {
        var rows = shown(tables[i]);
        if (rows.length > FLOOR) { rows[rows.length - 1].classList.add('x'); moved = true; break; }
      }
      if (!moved) return false;
    }
    return !over(pg);
  }

  /* Reveal hidden rows one at a time while the page still has room. */
  function grow(pg) {
    growables(pg).forEach(function (t) {
      var hidden = [].slice.call(t.querySelectorAll('tr.x'));
      for (var i = 0; i < hidden.length; i++) {
        hidden[i].classList.remove('x');
        if (over(pg)) { hidden[i].classList.add('x'); break; }
      }
    });
  }

  /* The "N further rows not shown" line changes height when its text
     rewraps, and removing it frees a row's worth of space, so the count is
     rewritten and THEN the page is re-tested. */
  function relabel(pg) {
    growables(pg).forEach(function (t) {
      var left = t.querySelectorAll('tr.x').length;
      var more = t.querySelector('tr.more');
      if (!more) return;
      if (!left) { more.parentNode.removeChild(more); return; }
      var note = t.getAttribute('data-more');
      more.querySelector('td').textContent =
        left + ' further row' + (left === 1 ? '' : 's') + ' not shown' + (note ? ', ' + note : '');
    });
    var guard = 40;
    while (over(pg) && guard-- > 0) {
      var t = growables(pg).filter(function (x) { return shown(x).length > FLOOR; })[0];
      if (!t) break;
      var rows = shown(t);
      rows[rows.length - 1].classList.add('x');
      var left = t.querySelectorAll('tr.x').length;
      var more = t.querySelector('tr.more');
      if (!more) {
        more = document.createElement('tr');
        more.className = 'more';
        var td = document.createElement('td');
        td.colSpan = t.querySelectorAll('thead th').length;
        more.appendChild(td);
        t.querySelector('tbody').appendChild(more);
      }
      var note2 = t.getAttribute('data-more');
      more.querySelector('td').textContent =
        left + ' further row' + (left === 1 ? '' : 's') + ' not shown' + (note2 ? ', ' + note2 : '');
    }
  }

  function run() {
    var doc = document.getElementById('doc');
    if (!doc) return;
    var blocks = [].slice.call(doc.querySelectorAll('.blk'));
    var oldPages = [].slice.call(doc.querySelectorAll('.pg'));
    if (!blocks.length || !oldPages.length) return;

    /* 1. repack. A block that does not fit is first SHRUNK into the space
          left on this page; only if it still will not fit does it start a
          new one. Shrink-then-grow is what stops a page ending at 28% just
          because the next table's opening size was one row too tall. */
    var proto = oldPages[0].cloneNode(false);
    oldPages.forEach(function (p) { p.parentNode.removeChild(p); });
    var out = [];
    function newPage() { var p = proto.cloneNode(false); doc.appendChild(p); out.push(p); return p; }
    var cur = newPage();
    blocks.forEach(function (b) {
      cur.appendChild(b);
      if (over(cur) && cur.querySelectorAll('.blk').length > 1 && !shrink(cur, b)) {
        cur = newPage();
        cur.appendChild(b);
      }
    });

    /* 2. give every page its chrome BEFORE measuring anything else. The
          running head is a real block in the flow: adding it after the fit
          pass pushed every page down by its own height, which is how page 2
          ended up 26px over a limit it had just been fitted to. */
    var runhead = document.body.getAttribute('data-runhead') || '';
    out.forEach(function (pg, i) {
      if (i > 0 && !pg.querySelector('.phead') && !pg.querySelector('.mast')) {
        /* The report's own title, not the page's first heading: with dynamic
           pagination a page can start mid-section, and repeating the heading
           that is already printed two lines below it reads as a mistake. */
        var h = document.createElement('div');
        h.className = 'phead';
        h.innerHTML = '<b>School Performance Report</b><span></span>';
        h.lastChild.innerHTML = runhead + ' · <span data-pageno></span>';
        pg.insertBefore(h, pg.firstChild);
      }
      if (!pg.querySelector('.pfoot')) {
        var f = document.createElement('div');
        f.className = 'pfoot';
        f.innerHTML = '<span></span><span data-pageno></span>';
        f.firstChild.textContent = runhead;
        pg.appendChild(f);
      }
    });

    /* 3. a head may have pushed the last block off; re-fit, then fill. */
    out.forEach(function (pg) {
      var blks = pg.querySelectorAll('.blk');
      if (over(pg) && blks.length) shrink(pg, blks[blks.length - 1]);
      grow(pg);
      relabel(pg);
    });

    /* 4. stamp the real page count. */
    out.forEach(function (pg, i) {
      var label = 'page ' + (i + 1) + ' of ' + out.length;
      [].slice.call(pg.querySelectorAll('[data-pageno]')).forEach(function (el) {
        el.textContent = label;
      });
    });
  }

  function go() { try { run(); } catch (e) { /* the static layout stands */ } }
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(go); }
  else if (document.readyState === 'complete') { go(); }
  else { window.addEventListener('load', go); }
})();
`;

export function buildSchoolPerformanceReportHtml(
  d: ReportSnapshot,
  cfg: ReportConfig = DEFAULT_REPORT_CONFIG,
): string {
  const T1 = cfg.labels.tier1;
  const T2 = cfg.labels.tier2;
  const T3 = cfg.labels.tier3;
  const T1p = cfg.labels.tier1Plural;
  const T2p = cfg.labels.tier2Plural;

  const shortName = (s: string) => String(s).replace(new RegExp(`\\s*${T1}$`, "i"), "");
  const shortCls = (s: string) => String(s).replace(/^Grade\s+/i, "");
  const pl2 = (n: number) => (n === 1 ? T2 : T2p).toLowerCase();

  const SCH = d.school;
  const TIER1 = d.wings;
  const CLASSES = TIER1.flatMap((w) => w.classes.map((c) => ({ ...c, t1: w })));

  /** Rows past `cap` ship hidden; the paginator reveals what the page can hold. */
  function table(head: Head[], rows: string[][], opts: TableOpts = {}): string {
    const cap = opts.cap ?? cfg.listCap;
    const grow = opts.grow !== false;
    const cell = (c: string, i: number) => `<td class="${head[i]?.n ? "n" : ""}">${c}</td>`;
    const hid = Math.max(0, rows.length - cap);
    const body = rows
      .map((r, i) => `<tr${grow && i >= cap ? ' class="x"' : ""}>${r.map(cell).join("")}</tr>`)
      .join("");
    const note = esc(opts.moreNote ?? "");
    return `<table${grow && hid ? ` data-grow data-more="${note}"` : ""}>
    <thead><tr>${head.map((h) => `<th class="${h.n ? "n" : ""}">${esc(h.t)}</th>`).join("")}</tr></thead>
    <tbody>${body}
      ${hid ? `<tr class="more"><td colspan="${head.length}">${hid} further ${plural(hid, "row")} not shown${note ? `, ${note}` : ""}</td></tr>` : ""}</tbody>
    ${opts.foot ? `<tfoot><tr>${opts.foot.map(cell).join("")}</tr></tfoot>` : ""}</table>`;
  }

  /* Bands carry the dashboard's four colours, always with the word beside the
     colour so the report survives a monochrome printer. */
  const bandTone: Record<string, string> = {
    exc: "st-exc",
    good: "st-good",
    watch: "st-watch",
    att: "st-att",
  };
  const bandHex: Record<string, string> = {
    exc: "#0B7A33",
    good: "#1F7A5C",
    watch: "#A55F09",
    att: "#B81E1E",
  };
  const bandTxt = (b: string | null) =>
    b ? `<span class="st ${bandTone[b] ?? ""}">${esc(cfg.bandLabels[b] ?? b)}</span>` : NA;
  const notStarted = (o: { chapters: number; chaptersDone: number; chaptersPartial: number }) =>
    o.chapters - o.chaptersDone - o.chaptersPartial;

  /* THE ONLY TWO REFERENCE POINTS IN THE REPORT. Coverage is measured against
     the share of the session elapsed, which comes from the academic calendar,
     and attendance against the board's 75% requirement. The report sets no
     target of its own. */
  const ELAPSED = d.meta.yearGone;
  const FLOOR = cfg.attendanceFloor;
  const covTone = (v: Num) => (v == null ? "" : v >= ELAPSED ? "st-exc" : "st-att");
  const covV = (v: Num) => `<span class="st ${covTone(v)}">${pc1(v)}</span>`;
  const attV = (v: Num) =>
    v == null ? NA : v < FLOOR ? `<span class="st st-att">${pc1(v)}</span>` : pc1(v);
  /* Scores carry no colour: there is no score target to measure them against. */
  const scoreV = (v: Num) => (v == null ? NA : pc1(v));

  /* Counts computed once, quoted by both the prose and the tables, so a
     sentence can never contradict the table beside it. The three that would
     need every row are counted in Postgres instead and arrive as numbers. */
  const behind = CLASSES.filter((c) => c.syllabus != null && c.syllabus < ELAPSED).sort(
    (a, b) => (a.syllabus ?? 0) - (b.syllabus ?? 0),
  );
  const assessed = d.subjRollup
    .filter((s) => s.acc != null)
    .sort((a, b) => (a.acc ?? 0) - (b.acc ?? 0));
  const unassessed = d.subjRollup.filter((s) => s.acc == null);
  const quiet = d.teachers.filter((t) => t.level === cfg.minimalLevel);
  const pipePct = SCH.papersPlanned ? (SCH.papers / SCH.papersPlanned) * 100 : null;
  const onPace = (pct: Num) => pct != null && pct >= ELAPSED;
  const F = {
    noPaper: SCH.pairsNoPaper,
    lowCls: CLASSES.slice().sort((a, b) => (a.syllabus ?? 0) - (b.syllabus ?? 0))[0],
    notStarted: notStarted(SCH),
    absent: d.absentees.total,
    streak: d.absentees.streak,
    atRisk: d.atRisk.total,
    never: d.meta.neverTotal,
    adoptPct: d.schoolStu.adopt_pct ?? null,
  };

  const runHead = `${esc(d.meta.school)} · ${esc(d.meta.asOf)}`;
  const blk = (html: string) => `<section class="blk">${html}</section>`;

  /* ---- the summary, one fact per line, zero-count lines dropped -------- */
  function summary(): string {
    const B = (v: string) => `<b>${v}</b>`;
    const pts = [
      `${B(pc1(SCH.attendance))} attendance`,
      `${B(pc1(SCH.accuracy))} average score across ${r0(SCH.papers)} papers`,
      `${B(pc1(SCH.syllabus))} syllabus coverage, at ${B(pc0(ELAPSED))} of the session`,
      `${B(r0(F.notStarted))} of ${r0(SCH.chapters)} chapters not started`,
      behind.length && F.lowCls
        ? `${B(`${behind.length} of ${CLASSES.length}`)} ${pl2(CLASSES.length)} behind the calendar, lowest ${esc(shortCls(F.lowCls.code))} at ${pc0(F.lowCls.syllabus)}`
        : `${B(`No ${T2.toLowerCase()}`)} is behind the calendar`,
      `${B(`${r0(SCH.papers)} of ${r0(SCH.papersPlanned)}`)} planned papers held (${pc0(pipePct)})`,
      `${B(`${SCH.wkDone} of ${SCH.wkPlanned}`)} papers held this week`,
      F.noPaper
        ? `${B(r0(F.noPaper))} ${T3.toLowerCase()}-${T2.toLowerCase()} ${plural(F.noPaper, "pair")} with no paper, excluded from averages`
        : "",
      SCH.pendingGrading
        ? `${B(r0(SCH.pendingGrading))} ${plural(SCH.pendingGrading, "paper")} written, results not published`
        : "",
      SCH.homework != null ? `${B(pc1(SCH.homework))} of set homework handed in` : "",
      `${B(`${quiet.length} of ${d.teachers.length}`)} teachers at ${cfg.engagementLevels[cfg.minimalLevel].toLowerCase()} engagement`,
      `${B(r0(F.atRisk))} students flagged at risk (${pc0(SCH.students ? (F.atRisk / SCH.students) * 100 : null)} of roster)`,
      F.absent
        ? `${B(r0(F.absent))} below the ${FLOOR}% CBSE attendance floor${F.streak ? `, ${F.streak} absent ${cfg.streakAlert}+ days` : ""}`
        : "",
      F.never ? `${B(r0(F.never))} students never signed in` : "",
      `${B(pc0(F.adoptPct))} of the roster active this week`,
    ].filter(Boolean);
    return `<ul class="pts">${pts.map((x) => `<li>${x}</li>`).join("")}</ul>`;
  }

  /* ---- blocks, in reading order; the paginator deals them into pages --- */

  const kpi = (k: string, v: string, sub: string) =>
    `<div class="kpi"><div class="k">${esc(k)}</div>
      <div class="v">${v}</div>
      <div class="s">${sub}</div></div>`;

  const bMast = blk(`<div class="mast">
      <div class="row">
        <div class="id">
          <div class="school">${esc(d.meta.school)}</div>
          <h1>School Performance Report</h1>
        </div>
        <div class="when"><b>${esc(d.meta.asOf)}</b><br>${esc(d.meta.year)} · ${pc0(ELAPSED)} elapsed</div>
      </div>
    </div>
    <div class="kpis">
      ${kpi("Average score", pc1(SCH.accuracy), `${r0(SCH.attempts)} attempts across ${r0(SCH.papers)} papers`)}
      ${kpi("Attendance", pc1(SCH.attendance), `${r0(SCH.students)} students, last ${d.meta.attDays} school days`)}
      ${kpi("Syllabus coverage", pc1(SCH.syllabus), `against ${pc0(ELAPSED)} of the session elapsed`)}
      ${kpi("Papers held", pc0(pipePct), `${r0(SCH.papers)} of ${r0(SCH.papersPlanned)} planned`)}
    </div>
    <h2>What the data says</h2>
    <div class="verdict">${summary()}</div>
    <p class="xs" style="margin:0">${r0(SCH.students)} students · ${r0(SCH.classCount)}
      ${pl2(SCH.classCount)} · ${TIER1.length} ${(TIER1.length === 1 ? T1 : T1p).toLowerCase()} ·
      ${r0(d.teachers.length)} teachers · ${r0(SCH.subjectPairs)} ${T3.toLowerCase()}-${T2.toLowerCase()} rows ·
      ${r0(SCH.chapters)} chapters in scope</p>`);

  const graded = d.bands.reduce((n, b) => n + b.n, 0);
  const bTwoCol = blk(`<div class="two">
      <div>
        <h2>Chapter state</h2>
        ${table(
          [H("State"), N("Chapters"), N("Share")],
          [
            [
              '<span class="st st-exc">Done</span>',
              r0(SCH.chaptersDone),
              pc1(SCH.chapters ? (SCH.chaptersDone / SCH.chapters) * 100 : null),
            ],
            [
              '<span class="st st-watch">Partly done</span>',
              r0(SCH.chaptersPartial),
              pc1(SCH.chapters ? (SCH.chaptersPartial / SCH.chapters) * 100 : null),
            ],
            [
              '<span class="st st-att">Not started</span>',
              r0(F.notStarted),
              pc1(SCH.chapters ? (F.notStarted / SCH.chapters) * 100 : null),
            ],
          ],
          { grow: false, foot: ["In scope", r0(SCH.chapters), "100%"] },
        )}
        <p class="xs">A partly-done chapter counts as half a finished one: ${r0(SCH.chaptersDone)} done
          of ${r0(SCH.chapters)} reports as ${pc1(SCH.syllabus)} coverage.</p>
      </div>
      <div>
        <h2>Where the students sit</h2>
        <div class="bar">${d.bands
          .map(
            (b) =>
              `<span style="width:${b.pct ?? 0}%;background:${bandHex[b.band] ?? "#CBD2DA"}"></span>`,
          )
          .join("")}</div>
        ${table(
          [H("Band"), N("Students"), N("Share")],
          d.bands.map((b) => [
            `<span class="chip" style="background:${bandHex[b.band] ?? "#CBD2DA"}"></span><span class="st ${bandTone[b.band] ?? ""}">${esc(cfg.bandLabels[b.band] ?? b.band)}</span>`,
            r0(b.n),
            pc1(b.pct),
          ]),
          { grow: false, foot: ["Graded", r0(graded), "100%"] },
        )}
        <p class="xs">Each student's own average across every graded paper, banded on the thresholds
          the dashboard uses. A student with no graded paper is not counted here.</p>
      </div>
    </div>`);

  const bSubjects = blk(`<h2>${esc(T3)}s, lowest average score first</h2>
    ${table(
      [H(T3), N("Papers"), N("Attempts"), N(T2p), N("Avg score"), N("Coverage")],
      assessed.map((s) => [
        `<div class="nm">${esc(s.name)}</div>`,
        r0(s.papers),
        r0(s.attempts),
        r0(s.classes),
        scoreV(s.acc),
        covV(s.cov),
      ]),
      { cap: cfg.caps.subjects, moreNote: `${assessed.length} assessed ${T3.toLowerCase()}s in total` },
    )}
    <p class="xs">Attempts is how much evidence sits behind the score: a ${T3.toLowerCase()} with a
      handful of results is one paper's worth of evidence, not a trend.${
        unassessed.length
          ? ` <b>${unassessed.length} not listed</b>: ${unassessed.map((s) => esc(s.name)).join(", ")}. No paper recorded anywhere this year, excluded from averages rather than scored zero.`
          : ""
      }</p>`);

  const bWings = blk(`<h2>Each ${esc(T1.toLowerCase())}</h2>
    ${table(
      [
        H(T1),
        N(T2p),
        N("Students"),
        N("Attendance"),
        N("Coverage"),
        N("Lessons"),
        N("Homework"),
        N("Avg score"),
        H("Band"),
      ],
      TIER1.map((w) => [
        `<div class="nm">${esc(shortName(w.name))}</div><div class="sub">${esc([w.span, w.head].filter(Boolean).join(" · "))}</div>`,
        r0(w.classCount),
        r0(w.students),
        attV(w.attendance),
        covV(w.syllabus),
        pc0(w.lessonPct),
        pc0(w.homework),
        scoreV(w.accuracy),
        bandTxt(w.band),
      ]),
      {
        grow: false,
        foot: [
          "School",
          r0(SCH.classCount),
          r0(SCH.students),
          pc1(SCH.attendance),
          pc1(SCH.syllabus),
          pc0(SCH.lessonPct),
          pc0(SCH.homework),
          pc1(SCH.accuracy),
          bandTxt(SCH.band),
        ],
      },
    )}`);

  const chaptersBehind = behind.reduce(
    (n, c) => n + Math.ceil(((ELAPSED - (c.syllabus ?? 0)) / 100) * c.chapters),
    0,
  );
  const cov = TIER1.map((w) => w.syllabus).filter((v): v is number => v != null);
  const acc = TIER1.map((w) => w.accuracy).filter((v): v is number => v != null);
  const covSpread = cov.length ? Math.max(...cov) - Math.min(...cov) : 0;
  const accSpread = acc.length ? Math.max(...acc) - Math.min(...acc) : 0;

  const bClasses = blk(`<h2>Each ${esc(T2.toLowerCase())}, lowest coverage first</h2>
    ${table(
      [
        H(T2),
        H(T1),
        N("Students"),
        N("Coverage"),
        N("vs calendar"),
        N("Not started"),
        N("Papers"),
        N("Attendance"),
        N("Avg score"),
        H("Band"),
      ],
      CLASSES.slice()
        .sort((a, b) => (a.syllabus ?? 0) - (b.syllabus ?? 0))
        .map((c) => [
          `<div class="nm">${esc(shortCls(c.code))}</div><div class="sub">${esc(c.teacherName)}</div>`,
          esc(shortName(c.t1.name)),
          r0(c.students),
          covV(c.syllabus),
          `<span class="st ${(c.syllabus ?? 0) >= ELAPSED ? "st-exc" : "st-att"}">${(c.syllabus ?? 0) >= ELAPSED ? "+" : "−"}${r1(Math.abs((c.syllabus ?? 0) - ELAPSED))}</span>`,
          `${r0(notStarted(c))} <span class="muted">of ${r0(c.chapters)}</span>`,
          r0(c.papers),
          attV(c.attendance),
          scoreV(c.accuracy),
          bandTxt(c.band),
        ]),
      {
        cap: cfg.caps.classes,
        moreNote: `${CLASSES.length} ${pl2(CLASSES.length)} in total, the rest level with the calendar or ahead`,
      },
    )}
    <p class="read">The <b>vs calendar</b> column is coverage minus ${pc0(ELAPSED)}, the share of the
      session elapsed: level means the ${esc(T2.toLowerCase())} has taught as much of the book as the
      year has spent. ${
        behind.length
          ? `<b>${behind.length} of ${CLASSES.length} ${pl2(CLASSES.length)}</b> are behind it, by <b>${r0(chaptersBehind)} chapters</b> in total.`
          : `No ${esc(T2.toLowerCase())} is behind it.`
      }
      Across ${esc(T1p.toLowerCase())}, coverage spans ${r1(covSpread)} points and average score
      ${r1(accSpread)}.</p>`);

  const bPipeline = blk(`<h2>Exam pipeline</h2>
    ${table(
      [
        H(T1),
        N("Held"),
        N("Planned"),
        N("Held %"),
        N("Results out"),
        N("Results pending"),
        N("On calendar"),
        N("In draft"),
        H("Against pace"),
      ],
      TIER1.map((w) => {
        const p = w.papersPlanned ? (w.papers / w.papersPlanned) * 100 : null;
        return [
          `<div class="nm">${esc(shortName(w.name))}</div>`,
          r0(w.papers),
          r0(w.papersPlanned),
          `<span class="st ${onPace(p) ? "st-exc" : "st-att"}">${pc0(p)}</span>`,
          r0(w.papersPublished),
          r0(w.pendingGrading),
          r0(w.papersScheduled),
          r0(w.papersDraft),
          onPace(p)
            ? '<span class="st st-exc">On pace</span>'
            : '<span class="st st-att">Behind</span>',
        ];
      }),
      {
        grow: false,
        foot: [
          "School",
          r0(SCH.papers),
          r0(SCH.papersPlanned),
          pc0(pipePct),
          r0(SCH.papersPublished),
          r0(SCH.pendingGrading),
          r0(SCH.papersScheduled),
          r0(SCH.papersDraft),
          onPace(pipePct)
            ? '<span class="st st-exc">On pace</span>'
            : '<span class="st st-att">Behind</span>',
        ],
      },
    )}
    <p class="read">The four states sum to the plan. Held is ${pc0(pipePct)} of the year's papers
      against ${pc0(ELAPSED)} of the session elapsed; a row reads Behind when the first is under the
      second. This week ${SCH.wkDone} of ${SCH.wkPlanned} scheduled papers were held.</p>`);

  const levels = Object.keys(cfg.engagementLevels);
  const bEngagement = blk(`<h2>Staffing and engagement by ${esc(T1.toLowerCase())}</h2>
    ${table(
      [
        H(`${T1} · coordinator`),
        N("Teachers"),
        ...levels.map((L) => N(cfg.engagementLevels[L])),
        N("Papers set, avg"),
        N("Days since login, avg"),
        N("Avg score"),
        N("Coverage"),
      ],
      TIER1.map((w) => {
        const st = d.teachers.filter((t) => t.wingId === w.id);
        /* A teacher who has never signed in has no "days since": averaging
           them in as zero would read as "logged in today". */
        const seen = st.map((t) => t.lastSeen).filter((v): v is number => v != null);
        return [
          `<div class="nm">${esc(shortName(w.name))}</div><div class="sub">${esc(w.head)}</div>`,
          r0(st.length),
          ...levels.map((L) => {
            const n = st.filter((t) => t.level === L).length;
            return `<span class="${L === cfg.minimalLevel && n ? "st st-att" : ""}">${r0(n)}</span>`;
          }),
          st.length ? r1(st.reduce((a, t) => a + t.tests, 0) / st.length) : NA,
          seen.length ? `${r1(seen.reduce((a, v) => a + v, 0) / seen.length)}d` : NA,
          scoreV(w.accuracy),
          covV(w.syllabus),
        ];
      }),
      { grow: false },
    )}
    <p class="read">Engagement is measured from platform activity only: papers set, homework set and
      days since last login. Student results are not an input to it and are reported separately in
      the last two columns. ${esc(cfg.engagementLevels[cfg.minimalLevel])} means fewer than two
      papers set this year, or seven or more days since logging in.</p>`);

  const lastSeenTxt = (v: number | null) =>
    v == null ? '<span class="st st-att">never</span>' : v === 0 ? "today" : `${v}d`;
  const bQuiet = blk(`<h2>Teachers at ${esc(cfg.engagementLevels[cfg.minimalLevel].toLowerCase())} engagement</h2>
    ${table(
      [
        H("Teacher"),
        H(T1),
        H(`${T3}s taught`),
        N(T2p),
        N("Last active"),
        N("Papers set"),
        N("Homework set"),
        N("Students' avg score"),
      ],
      quiet
        .slice()
        .sort(
          (a, b) => (b.lastSeen ?? Number.MAX_SAFE_INTEGER) - (a.lastSeen ?? Number.MAX_SAFE_INTEGER),
        )
        .map((t) => [
          `<div class="nm">${esc(t.name)}</div>`,
          esc(shortName(TIER1.find((w) => w.id === t.wingId)?.name ?? t.wingId ?? "")),
          `<span class="sub">${esc(clip(t.subjects, 34))}</span>`,
          r0(t.classes),
          `<span class="st ${t.lastSeen == null || t.lastSeen >= 7 ? "st-att" : ""}">${lastSeenTxt(t.lastSeen)}</span>`,
          `<span class="st ${t.tests < 2 ? "st-att" : ""}">${r0(t.tests)}</span>`,
          r0(t.hwGiven),
          t.avgScore == null ? NA : pc0(t.avgScore),
        ]),
      { cap: cfg.caps.quietTeachers, moreNote: `${quiet.length} at this level in total` },
    )}
    <p class="read">Listed in order of days since last login. The final column is the average score
      of the students these teachers take, reported alongside rather than combined into the
      engagement measure.</p>`);

  const bAttendance = blk(`<h2>Attendance and student flags by ${esc(T1.toLowerCase())}</h2>
    ${table(
      [
        H(T1),
        N("Students"),
        N("Attendance"),
        N(`Under ${FLOOR}%`),
        N("Flagged at risk"),
        N("Never signed in"),
        N("Active this week"),
      ],
      TIER1.map((w) => {
        const below = d.absentees.byWing[w.id] ?? 0;
        const never = d.meta.neverByWing[w.id] ?? 0;
        return [
          `<div class="nm">${esc(shortName(w.name))}</div>`,
          r0(w.students),
          attV(w.attendance),
          `<span class="st ${below ? "st-att" : "st-exc"}">${r0(below)}</span>`,
          r0(d.atRisk.byWing[w.id] ?? 0),
          `<span class="st ${never ? "st-watch" : "st-exc"}">${r0(never)}</span>`,
          pc0(w.stu.adopt_pct ?? null),
        ];
      }),
      {
        grow: false,
        foot: [
          "School",
          r0(SCH.students),
          pc1(SCH.attendance),
          r0(F.absent),
          r0(F.atRisk),
          r0(F.never),
          pc0(F.adoptPct),
        ],
      },
    )}
    <p class="read">Attendance is taken from the daily register over the last ${d.meta.attDays}
      school days and rolls up weighted by roster size, not as an average of
      ${esc(T2.toLowerCase())} percentages. ${r0(F.absent)} ${plural(F.absent, "student")}
      ${plural(F.absent, "is", "are")} below the ${FLOOR}% CBSE floor for board eligibility${
        F.streak
          ? `; ${F.streak} of those ${plural(F.streak, "has", "have")} been absent ${cfg.streakAlert} or more consecutive days`
          : ""
      }.</p>`);

  /* The reason is read off the thresholds, not inferred. */
  const reason = (s: ReportAtRiskRow) => {
    const r: string[] = [];
    if (s.attendance != null && s.attendance < FLOOR) r.push(`attendance under ${FLOOR}%`);
    if (s.band === "att") r.push("lowest score band");
    if (s.homework != null && s.homework < 50) r.push("under half of homework in");
    if (s.neverIn) r.push("never signed in");
    return r.length ? r.join(", ") : "combined index";
  };
  const bRisk = blk(`<h2>Students flagged by the risk index</h2>
    ${table(
      [
        H("Student"),
        H(T2),
        N("Risk index"),
        N("Avg score"),
        N("Attendance"),
        N("Homework"),
        H("Why listed"),
      ],
      d.atRisk.rows
        .slice()
        .sort((a, b) => (a.riskScore ?? 0) - (b.riskScore ?? 0))
        .map((s) => [
          `<div class="nm">${esc(s.name)}</div><div class="sub">${[s.roll ? `roll ${esc(s.roll)}` : "", esc(s.classTeacher)].filter(Boolean).join(" · ")}</div>`,
          esc(shortCls(s.cls)),
          `<b>${r1(s.riskScore)}</b>`,
          scoreV(s.score),
          attV(s.attendance),
          pc1(s.homework),
          `<span class="sub" style="font-size:7.4pt">${esc(reason(s))}</span>`,
        ]),
      { cap: cfg.caps.atRisk, moreNote: `${F.atRisk} flagged in total, lowest index first` },
    )}
    <p class="read">Risk index = ${esc(cfg.riskWeights)}. Lowest first. The final column says what
      put each student on the list; one entry alone is enough.</p>`);

  const bSign = blk(`<div class="sign">
      <div><div class="line"></div>Prepared by · ${esc(cfg.roles.prepared)}</div>
      <div><div class="line"></div>Reviewed by · ${esc(cfg.roles.reviewed)}</div>
      <div><div class="line"></div>Date</div>
    </div>`);

  /* Static pagination, which is what the native PDF path gets: html2pdf never
     runs the script. The paginator re-deals these in a browser; this split is
     the one that has to hold without it. */
  const head = (n: number) =>
    `<div class="phead"><b>School Performance Report</b><span>${runHead} · <span data-pageno>page ${n} of 4</span></span></div>`;
  const foot = (n: number) =>
    `<div class="pfoot"><span>${runHead}</span><span data-pageno>page ${n} of 4</span></div>`;

  const pages = [
    bMast + bTwoCol + bSubjects,
    head(2) + bWings + bClasses,
    head(3) + bPipeline + bEngagement + bQuiet,
    head(4) + bAttendance + bRisk + bSign,
  ]
    .map((inner, i) => `<div class="pg">${inner}${foot(i + 1)}</div>`)
    .join("");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.meta.school)} School Performance Report</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${STYLE}</style>
</head><body data-runhead="${runHead}"><div id="doc">${pages}</div>
<script>${PAGINATOR}</script>
</body></html>`;
}
