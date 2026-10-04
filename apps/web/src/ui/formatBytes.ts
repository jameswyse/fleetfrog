const units = ["KB", "MB", "GB", "TB"] as const;
const oneDecimal = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const wholeNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

function rounded(value: number): number {
  return value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${wholeNumber.format(bytes)} bytes`;
  }

  let value = bytes / 1000;
  let unit = 0;

  while (rounded(value) >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }

  return `${(value < 10 ? oneDecimal : wholeNumber).format(rounded(value))} ${units[unit]}`;
}
