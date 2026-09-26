/**
 * Each phase of a clone or fetch that Git reports with a percentage, and its share of one overall
 * bar. Receiving objects is most of the work. Sharing the bar this way means it only moves forward,
 * where each phase's own percentage would drop back to zero as the next phase began.
 */
const phases = [
  { pattern: /Receiving objects:\s+(\d+)%/, start: 0, share: 0.8 },
  { pattern: /Resolving deltas:\s+(\d+)%/, start: 0.8, share: 0.15 },
  { pattern: /(?:Updating|Checking out) files:\s+(\d+)%/, start: 0.95, share: 0.05 },
];

/**
 * How far a run has got, from 0 to 1, going by Git's latest progress line. Null before Git
 * reports a phase with a percentage, such as while the remote counts its objects.
 */
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
