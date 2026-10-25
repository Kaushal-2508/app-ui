export type TranslatedError = {
  title: string;
  description?: string;
  kind: "user" | "permission" | "conflict" | "network" | "technical";
  ref?: string;
};

type RawError = {
  message?: unknown;
  code?: unknown;
  details?: unknown;
  hint?: unknown;
  status?: unknown;
  name?: unknown;
};

const PG_CODE_MAP: Record<string, { title: string; description?: string; kind: TranslatedError["kind"] }> = {
  "23505": { title: "This already exists.", description: "Try a different value or check your existing records.", kind: "conflict" },
  "23503": { title: "Can't complete this. Something it depends on is missing.", description: "Please refresh the page and try again.", kind: "user" },
  "23502": { title: "A required field is missing.", description: "Please fill in all required fields.", kind: "user" },
  "23514": { title: "One of the values isn't allowed here.", description: "Please review your inputs and try again.", kind: "user" },
  "22001": { title: "A value is too long.", description: "Please shorten the text and try again.", kind: "user" },
  "22003": { title: "A number is out of range.", description: "Please enter a valid number.", kind: "user" },
  "22007": { title: "Invalid date format.", kind: "user" },
  "22P02": { title: "Invalid input format.", description: "One of the values isn't in the expected format.", kind: "user" },
  "40001": { title: "The system is busy. Please try again.", kind: "technical" },
  "40P01": { title: "The system is busy. Please try again.", kind: "technical" },
  "42501": { title: "You don't have permission to do this.", description: "Contact your administrator if you think this is a mistake.", kind: "permission" },
  "42P01": { title: "Something's misconfigured on our end.", kind: "technical" },
  "P0001": { title: "That action isn't allowed right now.", kind: "user" },
  "PGRST116": { title: "The record you're looking for doesn't exist.", kind: "user" },
  "PGRST301": { title: "Your session has expired.", description: "Please sign in again.", kind: "permission" },
};

const AUTH_MESSAGE_MAP: Array<[RegExp, { title: string; description?: string; kind: TranslatedError["kind"] }]> = [
  [/invalid login credentials/i, { title: "Email or password is incorrect.", kind: "user" }],
  [/email not confirmed/i, { title: "Please confirm your email first.", kind: "user" }],
  [/user already registered|already.*exists/i, { title: "An account with this email already exists.", kind: "conflict" }],
  [/password should be at least/i, { title: "Password is too short.", description: "Use at least 6 characters.", kind: "user" }],
  [/weak.*password/i, { title: "Please choose a stronger password.", kind: "user" }],
  [/rate limit|too many requests/i, { title: "Too many attempts. Please wait a moment and try again.", kind: "user" }],
  [/jwt expired|token.*expired/i, { title: "Your session has expired.", description: "Please sign in again.", kind: "permission" }],
  // Our own RPC guards say "Not authenticated" / "Not signed in" / "You must
  // be signed in to ..." in a dozen spellings; one translation for all of them.
  [/not authenticated|not signed in|signed out|must be signed in|need to be signed in/i, {
    title: "You're signed out.",
    description: "Sign in and try again.",
    kind: "permission",
  }],
  [/permission denied|row-level security|violates row-level security|not authori[sz]ed/i, {
    title: "You don't have permission to do this.",
    description: "Contact your administrator if you think this is a mistake.",
    kind: "permission",
  }],
  [/foreign key constraint/i, {
    title: "Can't complete this. A linked record is missing.",
    description: "Please refresh the page and try again.",
    kind: "user",
  }],
  [/duplicate key|unique constraint|already exists/i, {
    title: "This already exists.",
    description: "Try a different value or check your existing records.",
    kind: "conflict",
  }],
  [/violates check constraint/i, {
    title: "One of the values isn't allowed here.",
    description: "Please review your inputs and try again.",
    kind: "user",
  }],
  [/not null constraint|null value in column/i, {
    title: "A required field is missing.",
    kind: "user",
  }],
  [/network error|failed to fetch|networkerror/i, {
    title: "Can't reach the server.",
    description: "Check your internet connection and try again.",
    kind: "network",
  }],
  [/timeout|timed out/i, {
    title: "The request took too long.",
    description: "Please try again.",
    kind: "network",
  }],
];

/**
 * P0001 messages that may be shown verbatim (work-queue Task 4, 2026-10-05).
 *
 * P0001 is a RAISE EXCEPTION from one of our own triggers or RPCs. Some are
 * written for people ("You can only message your own classes."), some are
 * for developers ("dashboard: class not in scope", "Invalid publish_status:
 * x") and some interpolate identifiers ("Not authorised for institution
 * 3f2a..."). The old rule showed ANY short one. This list names the shapes we
 * have read in supabase/migrations and approve, by their opening words; every
 * other P0001 falls back to the generic title. `isLikelyUserFriendly` still
 * runs on top as the second line of defence (UUIDs, snake_case, colon-prefixed
 * developer tags), so a sentence that opens well but carries an id is still
 * caught. When a new RPC adds a user-facing message in another shape, add its
 * opening here, with the message read first.
 */
const P0001_ALLOWLIST: RegExp[] = [
  // Addressed to the person: who may do what, what to pick or fix.
  /^(You|Your|Only|Pick|Choose|Please|Keep|Give|Write|Add|Select|Ask|Save|Publish|Wait|Nobody|Sign in) /,
  // About the thing in hand.
  /^(This|That|The|A|An|Each|Every|Both|One|Too many|No|Nothing|Cannot) /,
  /^(Booking|Feedback|Slot|Exam|Attendance|Student|Teachers|Completed|Self-approval|Evidence|Destination|Overlapping|Period slot|Leave|Meeting|Class|Institution|Subject|Support|Optional group|Admission number|Roll number|Assignment) /,
  // The exam slot guard (CLAUDE.md section 30) opens with "Time clash:"; the
  // colon is the message's own, not a developer tag.
  /^Time clash: /,
  // Opens with a name or a count the server filled in; approved by their tail.
  /(Pick an active section|Cancel their slots first|do not belong to this school|not yet marked|cannot be deleted|cannot be changed|Use a different (admission|roll) number|Remove it there first)\.?$/,
];

/**
 * HINT codes our RPCs attach to messages they wrote for the screen (CLAUDE.md
 * section 30 and the PTM module). A hinted message is approved as a whole.
 */
const USER_FACING_HINT = /^(ptm_|exam_slot_)/;

function isApprovedP0001(message: string, hint: string | undefined): boolean {
  if (hint && USER_FACING_HINT.test(hint)) return true;
  return P0001_ALLOWLIST.some((re) => re.test(message));
}

const makeRef = () => Math.random().toString(36).slice(2, 8).toUpperCase();

const readField = (err: unknown, key: keyof RawError): string | undefined => {
  if (!err || typeof err !== "object") return undefined;
  const v = (err as Record<string, unknown>)[key as string];
  return typeof v === "string" ? v : undefined;
};

export function translateError(err: unknown, fallbackTitle = "Something went wrong."): TranslatedError {
  if (err == null) return { title: fallbackTitle, kind: "technical", ref: makeRef() };

  const code = readField(err, "code");
  const message = readField(err, "message") ?? (typeof err === "string" ? err : "");
  const hint = readField(err, "hint");
  const status = (err as RawError)?.status;

  // Priority 1: specific user-friendly messages from our own backend
  // (edge functions, DB triggers) that carry context a code-based translation
  // would throw away. These run BEFORE PG_CODE_MAP so the Postgres SQLSTATE
  // doesn't swallow our custom message.
  if (message) {
    const userExistsMatch = message.match(/A user with email ["']([^"']+)["'] already exists/i);
    if (userExistsMatch) {
      return {
        title: `${userExistsMatch[1]} is already registered.`,
        description: "Use a different email, or find and delete the existing account first.",
        kind: "conflict",
      };
    }

    // Phone and admission number are login identifiers, unique across every
    // school (idx_profiles_phone_unique, idx_profiles_admission_unique), so
    // the clash is usually with an account the person can't see. The generic
    // 23505 title ("This already exists.") never said which field.
    if (/idx_profiles_phone_unique/i.test(message)) {
      return {
        title: "This phone number is already in use.",
        description: "Another SALCI account has this number. Use a different number, or leave it empty.",
        kind: "conflict",
      };
    }
    if (/idx_profiles_admission_unique/i.test(message)) {
      return {
        title: "This admission number is already in use.",
        description: "Another SALCI account has this admission number. Use a different one.",
        kind: "conflict",
      };
    }

    const subjectDupeMatch = message.match(/A subject with this (name|code) already exists in this class/i);
    if (subjectDupeMatch) {
      const kind = subjectDupeMatch[1].toLowerCase();
      return {
        title: `A subject with this ${kind} already exists in this class.`,
        description: kind === "name"
          ? "Each subject in a class must have a unique name. Try a different name."
          : "Each subject in a class must have a unique code. Try a different code.",
        kind: "conflict",
      };
    }

    // Exam-structure lock (prevent_exam_structure_change trigger, raw P0001).
    // Runs before PG_CODE_MAP so the generic "that action isn't allowed" doesn't
    // swallow the real reason. Fires when editing/deleting anything tied to an
    // exam that already has recorded attempts (subjects, classes, questions…).
    if (/exam is locked|cannot modify exam structure/i.test(message)) {
      return {
        title: "This is part of an exam that already has student attempts.",
        description: "To change or remove it, delete or unlock that exam first.",
        kind: "user",
      };
    }

    // Attempt-start validator (validate_attempt_creation trigger, raw P0001).
    // Reached by a pupil starting an online exam, and by staff saving offline
    // marks for a student who has no attempt row yet. The generic P0001 text
    // hid "time window has expired" for two schools; name the reason.
    if (/exam time window has expired/i.test(message)) {
      return {
        title: "This exam's time window has closed.",
        description: "New attempts can't be created for it now.",
        kind: "user",
      };
    }
    if (/exam has not started yet/i.test(message)) {
      return { title: "This exam hasn't started yet.", kind: "user" };
    }
    if (/exam is not available for attempts/i.test(message)) {
      return {
        title: "This exam isn't open for attempts.",
        description: "Only a published or active exam can receive attempts.",
        kind: "user",
      };
    }
    if (/student is not assigned to this exam/i.test(message)) {
      return {
        title: "This student isn't in a class this exam is set for.",
        kind: "user",
      };
    }
  }

  // P0001 is a RAISE EXCEPTION from one of our own triggers or RPCs. The ones
  // written for people are shown as they are, but ONLY when their shape is on
  // the allowlist AND nothing technical is in them (Task 4: the old
  // show-any-short-message rule leaked "Not authorised for institution
  // <uuid>" and "Invalid publish_status: x"). The specific rewordings above
  // still win where the copy needs tuning.
  if (code === "P0001" && message && isApprovedP0001(message, hint) && isLikelyUserFriendly(message)) {
    return { title: message, kind: "user" };
  }
  // A P0001 that is really an auth guard ("Not authenticated", "Not authorized
  // to view this student", "dashboard: not authenticated") gets the shared
  // signed-out / permission wording instead of the generic P0001 title.
  if (code === "P0001" && message) {
    for (const [pattern, mapped] of AUTH_MESSAGE_MAP) {
      if (pattern.test(message)) return { ...mapped };
    }
  }
  // Any other P0001 written as a plain sentence shows as it is: it opens with
  // a capital letter, is short, and carries no identifier (Tushar's review,
  // 2026-10-07: the allowlist hid "PIN entry required first", "Results
  // already published", "Substitution not found", the swap refusal naming an
  // inactive teacher and every Teacher Targets message behind the generic
  // title). Developer tags ("dashboard: ..."), lowercase guards, snake_case
  // and UUIDs still fall through to the generic title.
  if (code === "P0001" && message && isPlainSentence(message)) {
    return { title: message, kind: "user" };
  }

  if (code && PG_CODE_MAP[code]) {
    return { ...PG_CODE_MAP[code] };
  }

  if (message) {
    for (const [pattern, mapped] of AUTH_MESSAGE_MAP) {
      if (pattern.test(message)) return { ...mapped };
    }
  }

  if (typeof status === "number" && status >= 500) {
    return {
      title: "The server ran into a problem.",
      description: "Please try again in a moment. If it keeps happening, contact support.",
      kind: "technical",
      ref: makeRef(),
    };
  }

  if (typeof status === "number" && (status === 401 || status === 403)) {
    return {
      title: "You don't have permission to do this.",
      description: "Contact your administrator if you think this is a mistake.",
      kind: "permission",
    };
  }

  if (message && isLikelyUserFriendly(message)) {
    return { title: message, kind: "user" };
  }

  return {
    title: fallbackTitle,
    description: "Our team has been notified. Please try again.",
    kind: "technical",
    ref: makeRef(),
  };
}

/** A sentence someone wrote for the screen: starts with a capital letter or
 *  a digit, has real words, and passes the identifier checks. */
function isPlainSentence(message: string): boolean {
  if (!/^[A-Z0-9]/.test(message)) return false;
  if (!/[A-Za-z]{3,}/.test(message)) return false;
  return isLikelyUserFriendly(message);
}

function isLikelyUserFriendly(message: string): boolean {
  if (!message) return false;
  if (message.length > 160) return false;
  const technicalMarkers = [
    /violates/i,
    /constraint/i,
    /relation\s+"/i,
    /syntax error/i,
    /pg[a-z_]*error/i,
    /\bfk\b/i,
    /_fkey/i,
    /_pkey/i,
    /column\s+"/i,
    /schema/i,
    /permission denied for/i,
    /does not exist$/i,
    /supabase/i,
    // Task 4: identifiers never belong on a toast.
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    // snake_case: a column, a status value, a function name.
    /\b[a-z]+_[a-z_]+\b/,
    // "dashboard: class not in scope", "recheck: not authorized": a developer
    // tag before the colon.
    /^[a-z0-9_]+: /,
  ];
  return !technicalMarkers.some((re) => re.test(message));
}
