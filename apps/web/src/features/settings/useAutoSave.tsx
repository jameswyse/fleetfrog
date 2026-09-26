import { useState } from "react";

import type { HubResult } from "@/rpc/hubConnection.ts";

export type SaveState =
  | { readonly _tag: "Idle" }
  | { readonly _tag: "Saving" }
  | { readonly _tag: "Saved" }
  | { readonly _tag: "Failed"; readonly message: string };

/** Saves each change as it is made and remembers how the latest save went. */
export function useAutoSave() {
  const [state, setState] = useState<SaveState>({ _tag: "Idle" });

  const save = (request: () => Promise<HubResult<unknown>>) => {
    setState({ _tag: "Saving" });
    void request().then((result) =>
      setState(
        result._tag === "Failure"
          ? { _tag: "Failed", message: `Not saved. ${result.message}` }
          : { _tag: "Saved" },
      ),
    );
  };

  return { state, save };
}

/** How the latest automatic save went. The region stays mounted so each change is announced. */
export function SaveStatus({ state }: { readonly state: SaveState }) {
  return (
    <p role="status" className="text-sm">
      {state._tag === "Saving" && <span className="text-ink-muted">Saving…</span>}
      {state._tag === "Saved" && <span className="text-clean">Saved</span>}
      {state._tag === "Failed" && <span className="text-danger">{state.message}</span>}
    </p>
  );
}
