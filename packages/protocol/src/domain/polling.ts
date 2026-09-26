import { Schema } from "effect";

const Seconds = Schema.Int.check(Schema.isGreaterThanOrEqualTo(5));

/** How often agents rescan. The hub switches to the watching interval while a dashboard is open. */
export const PollingSettings = Schema.Struct({
  idleStatusSeconds: Seconds,
  watchingStatusSeconds: Seconds,
  discoverySeconds: Seconds,
  githubSeconds: Seconds,
});
export type PollingSettings = typeof PollingSettings.Type;

export const defaultPollingSettings: PollingSettings = {
  idleStatusSeconds: 300,
  watchingStatusSeconds: 30,
  discoverySeconds: 1800,
  githubSeconds: 900,
};
