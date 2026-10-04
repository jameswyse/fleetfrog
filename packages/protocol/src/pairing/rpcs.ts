import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { MachineId, MachineInfo } from "../domain/machine.ts";
import { ReportedList, ReportedText } from "../domain/reported.ts";

export class InvalidPairingCode extends Schema.TaggedError<InvalidPairingCode>()(
  "InvalidPairingCode",
  {},
) {}

export class PairingRpcs extends RpcGroup.make(
  Rpc.make("Pair", {
    payload: {
      code: Schema.String,
      info: MachineInfo,
      suggestedRoots: ReportedList(ReportedText),
    },
    success: Schema.Struct({ machineId: MachineId, token: Schema.String }),
    error: InvalidPairingCode,
  }),
) {}
