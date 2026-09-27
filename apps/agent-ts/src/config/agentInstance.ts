/**
 * A named agent that runs beside the default one on the same machine, such as a development build
 * next to a release, with its own pairing, policy, action log and service. Both still share the
 * machine's checkouts, archive records and trash. `FLEETFROG_INSTANCE` names it, and the default
 * agent has no name.
 */
export const instanceVariable = "FLEETFROG_INSTANCE";

/** The instance this agent runs as. `bin.ts` refuses to start when the name is not valid. */
export function currentInstance(): string | undefined {
  return process.env[instanceVariable] || undefined;
}

/**
 * Lowercase letters and digits in words joined by single hyphens, because the name becomes part
 * of folder names, a systemd unit and a launchd label.
 */
export function isValidInstanceName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

/** `base` followed by the instance's name, such as `fleetfrog-dev`, or `base` alone for the default agent. */
export function instanceNamed(base: string): string {
  const name = currentInstance();

  return name === undefined ? base : `${base}-${name}`;
}
