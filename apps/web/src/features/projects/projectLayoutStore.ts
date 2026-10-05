import { useSyncExternalStore } from "react";

import { Effect, Schema } from "effect";

import { requestHub } from "@/rpc/hubConnection.ts";
import { onSessionChange } from "@/rpc/session.ts";
import { SavedProjectLayout, unsavedProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { ProjectLayout } from "@fleetfrog/protocol/domain/projectLayout";

type LayoutChange = (layout: ProjectLayout) => ProjectLayout;

const maximumAttempts = 5;
const SavedBroadcast = Schema.Struct({ owner: Schema.String, saved: SavedProjectLayout });
const decodeBroadcast = Schema.decodeUnknownOption(Schema.toCodecJson(SavedBroadcast));
const encodeBroadcast = Schema.encodeSync(Schema.toCodecJson(SavedBroadcast));

const switchedViewer: HubResult<void> = {
  _tag: "Failure",
  message: "You switched accounts before this change was saved.",
};

let owner: string | null = null;
let generation = 0;
let confirmed: SavedProjectLayout = unsavedProjectLayout;
let pending: ReadonlyArray<LayoutChange> = [];
let shown: ProjectLayout = confirmed.layout;
let queue: Promise<unknown> = Promise.resolve();
let channel: BroadcastChannel | null = null;
const listeners = new Set<() => void>();

function refresh(): void {
  const next = pending.reduce((layout, change) => change(layout), confirmed.layout);

  if (next === shown) {
    return;
  }

  shown = next;

  for (const listener of listeners) {
    listener();
  }
}

function confirm(saved: SavedProjectLayout, settled?: LayoutChange): void {
  if (saved.revision >= confirmed.revision) {
    confirmed = saved;
  }

  if (settled !== undefined) {
    pending = pending.filter((change) => change !== settled);
  }

  refresh();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

async function persist(change: LayoutChange, startedIn: number): Promise<HubResult<void>> {
  for (let attempt = 1; ; attempt += 1) {
    if (startedIn !== generation) {
      return switchedViewer;
    }

    const base = confirmed;
    const layout = change(base.layout);

    const result = await requestHub((client) =>
      client.SetProjectLayout({ layout, revision: base.revision }).pipe(
        Effect.map(({ revision }) => ({ _tag: "Saved", saved: { layout, revision } }) as const),
        Effect.catchTag("ProjectLayoutChanged", ({ current }) =>
          Effect.succeed({ _tag: "Changed", saved: current } as const),
        ),
      ),
    );

    if (startedIn !== generation) {
      return switchedViewer;
    }

    if (result._tag === "Failure") {
      confirm(confirmed, change);

      return result;
    }

    if (result.value._tag === "Saved") {
      confirm(result.value.saved, change);

      if (owner !== null) {
        // oxlint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel only reaches this origin and takes no target origin.
        channel?.postMessage(encodeBroadcast({ owner, saved: result.value.saved }));
      }

      return { _tag: "Success", value: undefined };
    }

    if (attempt === maximumAttempts) {
      confirm(result.value.saved, change);

      return {
        _tag: "Failure",
        message: "Your layout kept changing in another tab or device. Try again.",
      };
    }

    confirm(result.value.saved);
  }
}

export function startProjectLayout(): void {
  onSessionChange((state) => {
    if (state._tag !== "Known" || state.session._tag === "SignedOut") {
      return;
    }

    const { session } = state;
    const viewer = session._tag === "SignedIn" ? session.user.id : "open";

    if (viewer === owner) {
      confirm(session.projectLayout);

      return;
    }

    owner = viewer;
    generation += 1;
    confirmed = session.projectLayout;
    pending = [];
    refresh();
  });

  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("fleetfrog.projectLayout");

    channel.addEventListener("message", (event: MessageEvent<unknown>) => {
      const message = decodeBroadcast(event.data);

      if (message._tag === "Some" && message.value.owner === owner) {
        confirm(message.value.saved);
      }
    });
  }
}

export function useProjectLayout(): ProjectLayout {
  return useSyncExternalStore(subscribe, () => shown);
}

export function changeProjectLayout(change: LayoutChange): Promise<HubResult<void>> {
  const startedIn = generation;

  pending = [...pending, change];
  refresh();

  const saving = queue.then(() => persist(change, startedIn));

  queue = saving;

  return saving;
}
