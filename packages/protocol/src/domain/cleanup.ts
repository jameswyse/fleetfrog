import { Schema } from "effect";

export const CleanupSettings = Schema.Struct({
  ignoredBranches: Schema.Array(Schema.Trimmed.check(Schema.isNonEmpty())).check(Schema.isUnique()),
});
export type CleanupSettings = typeof CleanupSettings.Type;

export const defaultCleanupSettings: CleanupSettings = {
  ignoredBranches: ["master", "main", "develop", "dev", "staging", "uat", "pre-prod", "prod"],
};
