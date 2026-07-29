// optparse — deriving structured key-value data from a todo's raw keyboardText.
//
// The idea (see NOMENCLATURE.md, AREA: OptParse): the user imbues a todo with key-value
// data by typing a valueTag — a '#'-led, whitespace-delimited run — straight into the
// line, at essentially zero friction. There is no explicit key; the key is inferred from
// the value's shape. optparse scans the keyboardText, tests each valueTag against the
// known patterns, folds the matches into getKey, and hands back the text left over once
// the recognised tags are removed (visibleDisplayText).
//
// keyboardText stays the single source of truth: getKey is DERIVED here at parse time,
// never stored on the node and never sent over the wire — the same treatment depthLevel
// and documentPosition get. Re-parsing is cheap, and there is exactly one place the rules
// live. The visible page shows visibleDisplayText (tags stripped) while a row is at rest,
// and swaps back to the raw keyboardText the moment it is focused for editing.
//
// Today there is one pattern, date. More keys slot into the same scan later, each its
// own value-shape.

// The derived key-value bag. One per todo, possibly empty.
export interface GetKey {
  // A date, normalised to "YYYY-MM-DD" (see DATE). Derived like everything in getKey —
  // re-parsed from keyboardText on demand, never stored on the node.
  "date"?: string;
}

// optparse's output: the visible text after recognised tags are stripped, and the
// key-values they carried.
export interface Parsed {
  visibleDisplayText: string;
  getKey: GetKey;
}

// The date valueTag. Four shapes are accepted, all bounded by whitespace like every
// tag, and all resolving to a single "YYYY-MM-DD":
//
//   #2026-08-01     full ISO — a four-digit year, then month then day ('-' or '/')
//   #8-1  #08-01    a bare month/day ('-' or '/'); the year is assumed to be the current one
//   #aug1  #aug-1   a month NAME (abbreviated or full), then the day
//   #mon  #tomorrow a RELATIVE day — a bare word, resolved against `now` (see parseRelative)
//
// Month always precedes day: we read mm-dd or yyyy-mm-dd, never dd-mm (an American reading,
// by Mike's choice). The alternatives are ordered year-first so '#2026-08-01' takes the ISO
// branch rather than being half-eaten by the bare month/day one, and the bare word comes
// LAST so '#aug1' still takes the month-name-plus-day branch. The regex only fixes the
// SHAPE; parseDate decides whether it is a real date. A tag of the right shape but an
// impossible value (13-40, feb-30) parses to null and is left untouched in the visible text
// — which is also what keeps the bare-word branch safe: '#groceries' has a date's shape but
// no date's meaning, so it stays in the line like any other hashtag.
const DATE =
  /(?:^|\s)#((?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[-/]\d{1,2})|(?:[A-Za-z]+[-/]?\d{1,2})|(?:[A-Za-z]+))(?=\s|$)/g;

// Month name → number: three-letter abbreviations, full names, and the common "sept".
// Lower-cased before lookup.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Weekday name → JS day number (Sunday 0), for the relative tags. Three-letter
// abbreviations and full names, lower-cased before lookup like MONTHS.
const WEEKDAYS: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

// The day-offset tags: today, and tomorrow (also '#tom', which is what Mike actually types).
const OFFSET_DAYS: Record<string, number> = {
  today: 0,
  tomorrow: 1,
  tom: 1,
};

// (year, month, day) → "YYYY-MM-DD", or null if it is not a real date. The Date round-trip
// rejects impossible days (Feb 30, Apr 31, and leap-year edges): a bad day rolls the
// constructed Date into the following month, after which the fields no longer agree.
function toYMD(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// `now`'s local calendar day, plus `days`, as "YYYY-MM-DD". Built from the local
// year/month/date getters — the day arithmetic goes through the Date constructor, which
// rolls a day past the end of the month (or the year) over for us.
function dayOffset(days: number, now: Date): string | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  return toYMD(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

// A bare-word date tag — '#today', '#tom', '#monday' — resolved against `now`. Null if the
// word names no day we know, which is every ordinary hashtag.
//
// A weekday always names the NEXT one, strictly after today: '#mon' typed ON a Monday is
// next week's Monday, not this morning (Mike's call — it is how the word is used out loud,
// and '#today' says today explicitly when that is what you mean).
function parseRelative(word: string, now: Date): string | null {
  if (word in OFFSET_DAYS) return dayOffset(OFFSET_DAYS[word], now);
  const target = WEEKDAYS[word];
  if (target === undefined) return null;
  const delta = (target - now.getDay() + 7) % 7;
  return dayOffset(delta === 0 ? 7 : delta, now);
}

// Resolve one date tag's inner text (everything after the '#') to "YYYY-MM-DD", or null
// if it is not a real date. `now` supplies the assumed year for the two yearless forms,
// and the day the relative forms count from.
function parseDate(token: string, now: Date): string | null {
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(token))) {
    return toYMD(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  if ((m = /^(\d{1,2})[-/](\d{1,2})$/.exec(token))) {
    return toYMD(now.getFullYear(), Number(m[1]), Number(m[2]));
  }
  if ((m = /^([A-Za-z]+)[-/]?(\d{1,2})$/.exec(token))) {
    const month = MONTHS[m[1].toLowerCase()];
    return month ? toYMD(now.getFullYear(), month, Number(m[2])) : null;
  }
  if ((m = /^([A-Za-z]+)$/.exec(token))) {
    return parseRelative(m[1].toLowerCase(), now);
  }
  return null;
}

// `now` is injected (defaulting to the wall clock) so the yearless and relative date forms
// resolve against a single, testable moment.
//
// A relative tag ('#tom') resolves at PARSE time, so one left sitting in a line would mean a
// different day tomorrow. It cannot linger: blurring the line sinks whatever date was parsed
// into the stored `date` field and strips the tag for good (see main.ts's focusout handler),
// so the drift window is the edit itself.
export function optparse(keyboardText: string, now: Date = new Date()): Parsed {
  const getKey: GetKey = {};

  // One pass per pattern: strip each recognised tag out of the display text and fold its
  // value into getKey as we go. A date tag whose shape matched but whose value is not a
  // real date returns unchanged (the whole match, leading boundary and all), so it stays
  // in the visible text rather than silently vanishing. When more than one valid date
  // appears, the last wins. Replacing the whole match with a single space and then
  // collapsing runs keeps the words either side of a removed tag apart.
  const visibleDisplayText = keyboardText
    .replace(DATE, (whole: string, token: string) => {
      const ymd = parseDate(token, now);
      if (!ymd) return whole;
      getKey["date"] = ymd;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  return { visibleDisplayText, getKey };
}
