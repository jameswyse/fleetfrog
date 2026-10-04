import { Schema, SchemaGetter } from "effect";

export const maximumReportedText = 4096;

export const maximumReportedItems = 5000;

export const ReportedText = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transform((text) => text.slice(0, maximumReportedText)),
    encode: SchemaGetter.transform((text) => text),
  }),
);

export function ReportedList<S extends Schema.Top>(item: S) {
  return Schema.Array(item).pipe(
    Schema.decodeTo(Schema.Array(Schema.toType(item)), {
      decode: SchemaGetter.transform((items) => items.slice(0, maximumReportedItems)),
      encode: SchemaGetter.transform((items) => items),
    }),
  );
}
