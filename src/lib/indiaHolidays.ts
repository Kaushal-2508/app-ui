// Pre-seeded national + common state public holidays for Indian
// academic years. Dates are best-effort for CBSE/ICSE schools —
// admins can tick/untick before import. A fixed-date holiday (e.g.
// Republic Day) is tagged "national"; lunar/regional ones
// (Diwali, Holi, Eid, Onam, Pongal, Bihu) are tagged "regional" so
// the UI can group them. Dates for lunar/regional events are the
// Government of India gazetted dates where available.

export interface SeedHoliday {
  title: string;
  date: string;           // ISO yyyy-mm-dd
  category: "national" | "regional";
  description?: string;
}

type HolidayMap = Record<string, SeedHoliday[]>;

// Keyed by academic year ("2024-25" means Apr 2024 - Mar 2025).
export const INDIA_HOLIDAYS: HolidayMap = {
  "2024-25": [
    { title: "Eid al-Adha (Bakrid)",     date: "2024-06-17", category: "regional" },
    { title: "Muharram",                 date: "2024-07-17", category: "regional" },
    { title: "Independence Day",         date: "2024-08-15", category: "national" },
    { title: "Raksha Bandhan",           date: "2024-08-19", category: "regional" },
    { title: "Janmashtami",              date: "2024-08-26", category: "regional" },
    { title: "Ganesh Chaturthi",         date: "2024-09-07", category: "regional" },
    { title: "Milad-un-Nabi",            date: "2024-09-16", category: "regional" },
    { title: "Gandhi Jayanti",           date: "2024-10-02", category: "national" },
    { title: "Dussehra",                 date: "2024-10-12", category: "national" },
    { title: "Diwali (Deepavali)",       date: "2024-10-31", category: "national" },
    { title: "Govardhan Puja",           date: "2024-11-02", category: "regional" },
    { title: "Bhai Dooj",                date: "2024-11-03", category: "regional" },
    { title: "Guru Nanak Jayanti",       date: "2024-11-15", category: "national" },
    { title: "Christmas Day",            date: "2024-12-25", category: "national" },
    { title: "New Year's Day",           date: "2025-01-01", category: "national" },
    { title: "Makar Sankranti / Pongal", date: "2025-01-14", category: "regional" },
    { title: "Republic Day",             date: "2025-01-26", category: "national" },
    { title: "Maha Shivratri",           date: "2025-02-26", category: "regional" },
    { title: "Holi",                     date: "2025-03-14", category: "national" },
    { title: "Eid al-Fitr",              date: "2025-03-31", category: "regional" },
  ],
  "2025-26": [
    { title: "Good Friday",              date: "2025-04-18", category: "national" },
    { title: "Dr. Ambedkar Jayanti",     date: "2025-04-14", category: "national" },
    { title: "Ram Navami",               date: "2025-04-06", category: "regional" },
    { title: "Eid al-Adha (Bakrid)",     date: "2025-06-07", category: "regional" },
    { title: "Muharram",                 date: "2025-07-06", category: "regional" },
    { title: "Independence Day",         date: "2025-08-15", category: "national" },
    { title: "Raksha Bandhan",           date: "2025-08-09", category: "regional" },
    { title: "Janmashtami",              date: "2025-08-16", category: "regional" },
    { title: "Ganesh Chaturthi",         date: "2025-08-27", category: "regional" },
    { title: "Onam",                     date: "2025-09-05", category: "regional" },
    { title: "Milad-un-Nabi",            date: "2025-09-05", category: "regional" },
    { title: "Gandhi Jayanti",           date: "2025-10-02", category: "national" },
    { title: "Dussehra",                 date: "2025-10-02", category: "national" },
    { title: "Diwali (Deepavali)",       date: "2025-10-20", category: "national" },
    { title: "Govardhan Puja",           date: "2025-10-22", category: "regional" },
    { title: "Bhai Dooj",                date: "2025-10-23", category: "regional" },
    { title: "Guru Nanak Jayanti",       date: "2025-11-05", category: "national" },
    { title: "Christmas Day",            date: "2025-12-25", category: "national" },
    { title: "New Year's Day",           date: "2026-01-01", category: "national" },
    { title: "Makar Sankranti / Pongal", date: "2026-01-14", category: "regional" },
    { title: "Republic Day",             date: "2026-01-26", category: "national" },
    { title: "Maha Shivratri",           date: "2026-02-15", category: "regional" },
    { title: "Holi",                     date: "2026-03-04", category: "national" },
    { title: "Eid al-Fitr",              date: "2026-03-21", category: "regional" },
  ],
  "2026-27": [
    { title: "Ram Navami",               date: "2026-03-26", category: "regional" },
    { title: "Dr. Ambedkar Jayanti",     date: "2026-04-14", category: "national" },
    { title: "Good Friday",              date: "2026-04-03", category: "national" },
    { title: "Independence Day",         date: "2026-08-15", category: "national" },
    { title: "Gandhi Jayanti",           date: "2026-10-02", category: "national" },
    { title: "Diwali (Deepavali)",       date: "2026-11-08", category: "national" },
    { title: "Christmas Day",            date: "2026-12-25", category: "national" },
    { title: "Republic Day",             date: "2027-01-26", category: "national" },
    { title: "Holi",                     date: "2027-03-22", category: "national" },
  ],
};

export function seedHolidaysFor(academicYear: string): SeedHoliday[] {
  return INDIA_HOLIDAYS[academicYear] ?? [];
}
