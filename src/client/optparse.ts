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

export function optparse(keyboardText: string): Parsed {
  const getKey: GetKey = {};
  let minutes = 0;
  let matched = false;

  // One pass: strip each recognised tag out of the display text and fold its value into
  // getKey as we go. Replacing the whole match (any leading boundary space included) with
  // a single space and then collapsing runs keeps the words either side of a removed tag
  // apart without leaving a double space behind.
  const visibleDisplayText = keyboardText
    .replace(TIME_EST, (_tag, amount: string, unit: string) => {
      minutes += unit === "hr" ? Number(amount) * 60 : Number(amount);
      matched = true;
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();

  // time-est is stored as integer minutes (NOMENCLATURE, OptParse), so a fractional tag
  // such as '#2.5hr' (150) or an odd '#2.5min' folds down to a whole number here.
  if (matched) getKey["time-est"] = Math.round(minutes);
  return { visibleDisplayText, getKey };
}
