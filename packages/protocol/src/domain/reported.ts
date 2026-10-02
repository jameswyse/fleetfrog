import { Schema, SchemaGetter } from "effect";

/**
 * The longest text the hub keeps from an agent: the longest path Linux allows, and far past any
 * branch name, commit subject or pull request title.
 */
export const maximumReportedText = 4096;

/**
 * The most items the hub keeps from any one list an agent reports, and the most checkouts it keeps
 * for a machine. Agents cap their own lists far below this.
 */
export const maximumReportedItems = 5000;

/**
 * Text an agent reports, cut to `maximumReportedText` as it's decoded, so one compromised agent
 * can't fill the hub's database or every dashboard's memory. Cutting rather than refusing keeps a
 * whole report from failing over one field, and keeps every stored reading decodable.
 */
export const ReportedText = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((text) => text.slice(0, maximumReportedText)),
    encode: SchemaGetter.transform((text) => text),
  }),
);

/** A list an agent reports, cut to `maximumReportedItems` as it's decoded, as `ReportedText` is. */
export function ReportedList<S extends Schema.Top>(item: S) {
  return Schema.Array(item).pipe(
    Schema.decodeTo(Schema.Array(Schema.toType(item)), {
      decode: SchemaGetter.transform((items) => items.slice(0, maximumReportedItems)),
      encode: SchemaGetter.transform((items) => items),
    }),
  );
}
