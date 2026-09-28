/**
 * Account names that paths and remote addresses carry. A home folder is named after its account,
 * and a remote's address holds the owner's name, such as `git@github.com:owner/shop.git`.
 */
const personalPattern = new RegExp(
  [
    String.raw`(?<=/home/|/Users/|\\Users\\)[^/\\\s]+`,
    // The user in `https://user@host/…`, but not the `git` user every SSH remote shares.
    String.raw`(?<=://)(?!git@)[^@/\s]+(?=@)`,
    String.raw`(?<=(?:@|://)[\w.-]+[/:])[^/\s]+(?=/)`,
  ].join("|"),
  "gu",
);

export interface TextPart {
  readonly text: string;
  readonly personal: boolean;
}

/** Splits text around the account names in it, keeping every character in order. */
export function personalParts(text: string): ReadonlyArray<TextPart> {
  const parts: Array<TextPart> = [];
  let end = 0;

  for (const match of text.matchAll(personalPattern)) {
    if (match.index > end) {
      parts.push({ text: text.slice(end, match.index), personal: false });
    }

    parts.push({ text: match[0], personal: true });
    end = match.index + match[0].length;
  }

  if (end < text.length) {
    parts.push({ text: text.slice(end), personal: false });
  }

  return parts;
}

/** Hides the account names in text that can't be blurred, such as a tooltip or a menu option. */
export function maskPersonal(text: string): string {
  return text.replace(personalPattern, "•••");
}
