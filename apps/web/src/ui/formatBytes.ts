const units = ["KB", "MB", "GB", "TB"] as const;
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

/** The value as it will be shown: one decimal place below 10, whole numbers above. */
function rounded(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

/** A size in decimal units, as macOS shows files: 850 bytes, 4.2 MB, 312 MB. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${wholeNumber.format(bytes)} bytes`;
  }

  let value = bytes / 1000;
  let unit = 0;

  // Rounding first means 999,600 bytes shows as 1 MB rather than 1,000 KB.
  while (rounded(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${(value < 10 ? oneDecimal : wholeNumber).format(rounded(value))} ${units[unit]}`;
}
