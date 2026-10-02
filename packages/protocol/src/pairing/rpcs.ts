import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";

import { MachineId, MachineInfo } from "../domain/machine.ts";
import { ReportedList, ReportedText } from "../domain/reported.ts";

export class InvalidPairingCode extends Schema.TaggedError<InvalidPairingCode>()(
  "InvalidPairingCode",
  {},
) {}

/** Served over HTTPS on the agent port. The only agent call that needs no token. */
export class PairingRpcs extends RpcGroup.make(
  Rpc.make("Pair", {
    payload: {
      code: Schema.String,
      info: MachineInfo,
      /** Common development folders that exist on the machine, used as its first discovery roots. */
      suggestedRoots: ReportedList(ReportedText),
    },
    success: Schema.Struct({ machineId: MachineId, token: Schema.String }),
    error: InvalidPairingCode,
  }),
) {}
