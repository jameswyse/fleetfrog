const unitSizes = [
  ["day", 86_400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
] as const;

type Unit = (typeof unitSizes)[number][0];

const unitFormat = (unit: Unit) =>
  new Intl.NumberFormat(undefined, { style: "unit", unit, unitDisplay: "short" });

const formats = {
  day: unitFormat("day"),
  hour: unitFormat("hour"),
  minute: unitFormat("minute"),
  second: unitFormat("second"),
} satisfies Record<Unit, Intl.NumberFormat>;

export function formatDuration(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);
  const index = unitSizes.findIndex(([, size]) => total >= size);
  const largest = unitSizes[index];

  if (largest === undefined) {
    return `<${formats.second.format(1)}`;
  }

  const [unit, size] = largest;
  const whole = formats[unit].format(Math.floor(total / size));
  const next = unitSizes[index + 1];
  const rest = next === undefined ? 0 : Math.floor((total % size) / next[1]);

  return next === undefined || rest === 0 ? whole : `${whole} ${formats[next[0]].format(rest)}`;
}
