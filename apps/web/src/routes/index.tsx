import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { OverviewPage } from "@/features/overview/OverviewPage.tsx";

const OverviewSearch = Schema.Struct({
  filter: Schema.optionalKey(Schema.Literals(["changes", "out-of-sync"])),
  q: Schema.optionalKey(Schema.String),
  /** The open checkout, as `<machine id>:<path>`. */
  checkout: Schema.optionalKey(Schema.String),
});

export const Route = createFileRoute("/")({
  validateSearch: Schema.toStandardSchemaV1(OverviewSearch),
  component: OverviewPage,
});
