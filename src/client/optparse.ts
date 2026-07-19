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
// live.
//
// Today there is one pattern, time-est. More keys slot into the same scan later, each its
// own value-shape.

// The derived key-value bag. One per todo, possibly empty. time-est is integer minutes
// (the only thing done with the number is summing it — see cumulativeTimeEstUnchecked).
export interface GetKey {
  "time-est"?: number;
  // A due date, normalised to "YYYY-MM-DD" (see DUE_DATE). Derived like everything in
  // getKey — re-parsed from keyboardText on demand, never stored on the node.
  "due-date"?: string;
}

// optparse's output: the visible text after recognised tags are stripped, and the
// key-values they carried.
export interface Parsed {
  visibleDisplayText: string;
  getKey: GetKey;
}

// The time-est valueTag: '#', a number (whole or with a decimal fraction, so both '#2hr'
// and '#2.5hr' read), then 'hr' or 'min', with nothing between the parts, and the whole tag
// bounded by whitespace or a string end. So '#30min', '#2hr' and '#2.5hr' match, while
// '#30minutes' (trailing letters), '#1 hr' (a space splits it) and 'email#30min' (the '#'
// is not at a tag boundary) do not — they are left untouched in the visible text. Multiple
// time-est tags on one line sum, so '#1hr #30min' reads as 90 minutes, which is also just a
// natural way to write an hour and a half.
const TIME_EST = /(?:^|\s)#(\d+(?:\.\d+)?)(hr|min)(?=\s|$)/g;

// The due-date valueTag. Three shapes are accepted, all bounded by whitespace like every
// tag, and all resolving to a single "YYYY-MM-DD":
//
//   #2026-08-01     full ISO — a four-digit year, then month then day ('-' or '/')
//   #8-1  #08-01    a bare month/day ('-' or '/'); the year is assumed to be the current one
//   #aug1  #aug-1   a month NAME (abbreviated or full), then the day
//
// Month always precedes day: we read mm-dd or yyyy-mm-dd, never dd-mm (an American reading,
// by Mike's choice). The alternatives are ordered year-first so '#2026-08-01' takes the ISO
// branch rather than being half-eaten by the bare month/day one. The regex only fixes the
// SHAPE; parseDueDate decides whether it is a real date. A tag of the right shape but an
// impossible value (13-40, feb-30) parses to null and is left untouched in the visible text,
// exactly as a malformed time tag is.
const DUE_DATE =
  /(?:^|\s)#((?:\d{4}[-/]\d{1,2}[-/]\d{1,2})|(?:\d{1,2}[-/]\d{1,2})|(?:[A-Za-z]+[-/]?\d{1,2}))(?=\s|$)/g;

// Month name → number: three-letter abbreviations, full names, and the common "sept".
// Lower-cased before lookup.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
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

// Resolve one due-date tag's inner text (everything after the '#') to "YYYY-MM-DD", or null
// if it is not a real date. `now` supplies the assumed year for the two yearless forms.
function parseDueDate(token: string, now: Date): string | null {
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
  return null;
}

// `now` is injected (defaulting to the wall clock) so the yearless date forms and any future
// clock-dependent key resolve against a single, testable moment.
export function optparse(keyboardText: string, now: Date = new Date()): Parsed {
  const getKey: GetKey = {};
  let minutes = 0;
  let matched = false;

  // One pass per pattern: strip each recognised tag out of the display text and fold its
  // value into getKey as we go. Replacing the whole match (any leading boundary space
  // included) with a single space and then collapsing runs keeps the words either side of a
  // removed tag apart without leaving a double space behind.
  const visibleDisplayText = keyboardText
    .replace(TIME_EST, (_tag, amount: string, unit: string) => {
      minutes += unit === "hr" ? Number(amount) * 60 : Number(amount);
      matched = true;
      return " ";
    })
    // A due-date tag whose shape matched but whose value is not a real date returns unchanged
    // (the whole match, leading boundary and all), so it stays in the visible text rather
    // than silently vanishing. When more than one valid due-date appears, the last wins.
    .replace(DUE_DATE, (whole: string, token: string) => {
      const ymd = parseDueDate(token, now);
      if (!ymd) return whole;
      getKey["due-date"] = ymd;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  // time-est is stored as integer minutes (NOMENCLATURE, OptParse), so a fractional tag
  // such as '#2.5hr' (150) or an odd '#2.5min' folds down to a whole number here.
  if (matched) getKey["time-est"] = Math.round(minutes);
  return { visibleDisplayText, getKey };
}
