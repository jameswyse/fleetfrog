const phases = [
  { pattern: /Receiving objects:\s+(\d+)%/, start: 0, share: 0.8 },
  { pattern: /Resolving deltas:\s+(\d+)%/, start: 0.8, share: 0.15 },
  { pattern: /(?:Updating|Checking out) files:\s+(\d+)%/, start: 0.95, share: 0.05 },
];

export function progressFraction(progress: string | null): number | null {
  if (progress === null) {
    return null;
  }

  for (const { pattern, start, share } of phases) {
    const percent = pattern.exec(progress)?.[1];

    if (percent !== undefined) {
      return start + (share * Math.min(Number(percent), 100)) / 100;
    }
  }

  return null;
}
