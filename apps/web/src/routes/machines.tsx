import { createFileRoute } from "@tanstack/react-router";
import { Schema } from "effect";

import { MachinesPage } from "@/features/machines/MachinesPage.tsx";

const MachinesSearch = Schema.Struct({
  /** Opens the pairing dialog, e.g. from the overview's empty state. */
  pair: Schema.optionalKey(Schema.Boolean),
});

export const Route = createFileRoute("/machines")({
  validateSearch: Schema.toStandardSchemaV1(MachinesSearch),
  component: MachinesPage,
});
