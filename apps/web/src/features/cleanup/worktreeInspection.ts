import type { HubResult } from "@/rpc/hubConnection.ts";
import type { InspectionResult, WorktreeInspection } from "@fleetfrog/protocol/domain/trash";

export type WorktreeInspectionState =
  | { readonly _tag: "Checking" }
  | { readonly _tag: "Failed"; readonly message: string }
  | { readonly _tag: "Ready"; readonly inspection: WorktreeInspection };

export function worktreeInspectionFrom(
  result: HubResult<InspectionResult>,
): WorktreeInspectionState {
  if (result._tag === "Failure") {
    return { _tag: "Failed", message: result.message };
  }

  const { value } = result;

  if (value._tag === "WorktreeInspected") {
    return { _tag: "Ready", inspection: value.inspection };
  }

  return {
    _tag: "Failed",
    message: value._tag === "Failed" ? value.message : "The machine inspected the wrong thing.",
  };
}
