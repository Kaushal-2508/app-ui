import {
  slotsForDay,
  type PeriodStructureV2,
  type ResolvedSlotV2,
  type Weekday,
} from "@/hooks/useTimetableV2";
import { printHtml } from "@/lib/native";

// --------------------------------------------------------------
// Printable v2 timetable. Mirrors the legacy openTimetablePrintWindow
// pattern: pops a clean window with embedded CSS, builds a static
// HTML grid, and triggers print(). Avoids the Tailwind runtime in
// the new window so the print is reproducible without our app
// chrome leaking in.
// --------------------------------------------------------------

interface PrintArgs {
  className: string;
  classSection: string | null;
  academicYear: string;
  institutionName?: string;
  structure: PeriodStructureV2;
  slots: ResolvedSlotV2[];
  /** Subjects (and their teachers) inside each optional group scheduled for
      this class, so a basket period prints what actually runs in it instead
      of just the basket's name. */
  optionalGroups?: { id: string; name: string; subjects: { name: string; teacher_name: string | null }[] }[];
}

const DAY_LABEL: Record<Weekday, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function openTimetablePrintWindowV2(args: PrintArgs): void {
  const { className, classSection, academicYear, institutionName, structure, slots } = args;
  const groupById = new Map((args.optionalGroups ?? []).map((g) => [g.id, g]));

  const title = `${escapeHtml(className)}${
    classSection ? ` - ${escapeHtml(classSection)}` : ""
  } · Timetable`;

  const orderedSlots = [...structure.slots].sort((a, b) =>
    a.start_time.localeCompare(b.start_time),
  );
  const workingDays = structure.working_days;

  // Pre-compute the effective period set per day so the printout shows "—"
  // for cells where the period doesn't apply (e.g. afternoon columns on a
  // Saturday-shorter override schedule).
  const effectivePeriodIdsByDay = new Map<Weekday, Set<string>>();
  for (const day of workingDays) {
    effectivePeriodIdsByDay.set(day, new Set(slotsForDay(structure.slots, day).map((p) => p.id)));
  }

  const byCell = new Map<string, ResolvedSlotV2>();
  for (const s of slots) {
    byCell.set(`${s.day}::${s.period_slot_id}`, s);
  }

  const rowsHtml = orderedSlots
    .map((slot) => {
      const periodLabel = escapeHtml(slot.label || `Period ${slot.period_number}`);
      const timeRange = `${slot.start_time.slice(0, 5)}–${slot.end_time.slice(0, 5)}`;

      if (slot.kind === "break") {
        return `
          <tr class="break-row">
            <td class="period-cell">${periodLabel}<span class="time">${timeRange}</span></td>
            <td class="break-cell" colspan="${workingDays.length}">
              <em>${periodLabel} break</em>
            </td>
          </tr>
        `;
      }

      const cells = workingDays
        .map((day) => {
          if (!(effectivePeriodIdsByDay.get(day)?.has(slot.id) ?? false)) {
            return `<td class="slot-cell"><span class="empty">N/A</span></td>`;
          }
          const existing = byCell.get(`${day}::${slot.id}`);
          return `<td class="slot-cell">${renderCell(existing, groupById)}</td>`;
        })
        .join("");

      return `
        <tr>
          <td class="period-cell">${periodLabel}<span class="time">${timeRange}</span></td>
          ${cells}
        </tr>
      `;
    })
    .join("");

  const headerCells = workingDays
    .map((day) => `<th>${DAY_LABEL[day]}</th>`)
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif;
      padding: 32px;
      color: #111;
      background: #fff;
    }
    .header {
      text-align: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 2px solid #111;
    }
    .header h1 { font-size: 22px; margin-bottom: 4px; }
    .header .meta { font-size: 12px; color: #555; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      table-layout: fixed;
    }
    thead th {
      background: #eee;
      text-align: center;
      padding: 8px 6px;
      font-weight: 600;
      border: 1px solid #999;
    }
    thead th.period-col { width: 110px; }
    td {
      border: 1px solid #ccc;
      padding: 6px 6px;
      vertical-align: top;
      min-height: 56px;
      height: 56px;
    }
    td.period-cell {
      background: #f6f6f6;
      font-weight: 600;
      text-align: center;
      font-size: 11px;
    }
    td.period-cell .time {
      display: block;
      font-weight: 400;
      color: #666;
      font-size: 10px;
      margin-top: 2px;
    }
    td.slot-cell { background: #fff; }
    td.break-cell {
      background: #fafafa;
      text-align: center;
      color: #777;
      font-style: italic;
    }
    .subject { font-weight: 600; font-size: 11px; }
    .teacher { color: #555; font-size: 10px; margin-top: 2px; }
    .kind { color: #666; font-size: 10px; }
    .empty { color: #bbb; font-size: 10px; font-style: italic; }
    .footer {
      margin-top: 24px;
      font-size: 10px;
      color: #888;
      text-align: center;
      border-top: 1px solid #eee;
      padding-top: 8px;
    }
    @media print {
      body { padding: 14px; }
      thead { display: table-header-group; }
      tr { page-break-inside: avoid; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(className)}${
      classSection ? ` - ${escapeHtml(classSection)}` : ""
    }</h1>
    <div class="meta">
      ${institutionName ? escapeHtml(institutionName) + " · " : ""}
      Academic year ${escapeHtml(academicYear)} ·
      ${escapeHtml(structure.name)}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th class="period-col">Period</th>
        ${headerCells}
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    Printed ${new Date().toLocaleString()}
  </div>
</body>
</html>`;

  // The popup used to stay open after printing; keep that.
  void printHtml(html, { closeAfter: false });
}

function renderCell(
  slot: ResolvedSlotV2 | undefined,
  groupById?: Map<string, { name: string; subjects: { name: string; teacher_name: string | null }[] }>,
): string {
  if (!slot) return `<span class="empty">N/A</span>`;
  if (slot.optional_group_id) {
    // Group cell: the whole basket runs in parallel — print the group
    // name (the workspace passes raw, un-substituted slots here).
    const label = slot.optional_group_name ?? "Optional";
    // List the subjects: printing only the basket name left staff and parents
    // unable to tell which class a child actually attends, or who teaches it.
    const lines = (groupById?.get(slot.optional_group_id)?.subjects ?? [])
      .map((sub) =>
        `<div class="teacher">${escapeHtml(sub.name)}${
          sub.teacher_name ? ` &middot; ${escapeHtml(sub.teacher_name)}` : ""
        }</div>`,
      )
      .join("");
    return `
      <div class="subject">${escapeHtml(label)}</div>
      ${lines || `<div class="teacher">Optionals in parallel</div>`}
    `;
  }
  if (slot.slot_type === "other") {
    const label = slot.custom_label ?? "Other";
    return `
      <div class="kind">${escapeHtml(label)}</div>
    `;
  }
  const isAcademic = slot.slot_type === "theory" || slot.slot_type === "practical";
  if (isAcademic) {
    const subj = slot.subject_name ?? "N/A";
    const kind = slot.slot_type === "practical" ? " (Prac.)" : "";
    return `
      <div class="subject">${escapeHtml(subj)}${kind}</div>
      ${slot.teacher_name ? `<div class="teacher">${escapeHtml(slot.teacher_name)}</div>` : ""}
    `;
  }
  const label = capitalize(slot.slot_type);
  return `
    <div class="kind">${escapeHtml(label)}</div>
    ${slot.teacher_name ? `<div class="teacher">${escapeHtml(slot.teacher_name)}</div>` : ""}
  `;
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
