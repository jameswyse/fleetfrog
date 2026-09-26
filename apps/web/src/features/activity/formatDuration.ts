const units = (unit: "second" | "minute" | "hour") =>
  new Intl.NumberFormat(undefined, { style: "unit", unit, unitDisplay: "short" });
const seconds = units("second");
const minutes = units("minute");
const hours = units("hour");

/** How long something took, to the second and in at most two units, such as "4 min 12 sec". */
export function formatDuration(milliseconds: number): string {
  const total = Math.round(milliseconds / 1000);

  if (total < 1) {
    return `<${seconds.format(1)}`;
  }

  if (total < 60) {
    return seconds.format(total);
  }

  if (total < 3600) {
    const rest = total % 60;
    const whole = minutes.format(Math.floor(total / 60));

    return rest === 0 ? whole : `${whole} ${seconds.format(rest)}`;
  }

  const rest = Math.floor((total % 3600) / 60);
  const whole = hours.format(Math.floor(total / 3600));

  return rest === 0 ? whole : `${whole} ${minutes.format(rest)}`;
}
