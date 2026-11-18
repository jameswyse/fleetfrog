import { Option, SubscriptionRef } from "effect";

import type { MachineId } from "@fleetfrog/protocol/domain/machine";

export type UpdateTransition<A> =
  | { readonly kind: "keep" }
  | { readonly kind: "clear" }
  | { readonly kind: "set"; readonly update: A };

export const keep = { kind: "keep" } as const;
export const clear = { kind: "clear" } as const;
export const set = <A>(update: A) => ({ kind: "set", update }) as const;

export function withUpdate<A>(current: ReadonlyMap<MachineId, A>, machineId: MachineId, update: A) {
  return new Map(current).set(machineId, update);
}

function withoutUpdate<A>(current: ReadonlyMap<MachineId, A>, machineId: MachineId) {
  const next = new Map(current);

  next.delete(machineId);

  return next;
}

export function transitionUpdate<A>(
  updates: SubscriptionRef.SubscriptionRef<ReadonlyMap<MachineId, A>>,
  machineId: MachineId,
  decide: (update: A | undefined) => UpdateTransition<A>,
) {
  return SubscriptionRef.updateSome(updates, (current) => {
    const decision = decide(current.get(machineId));

    switch (decision.kind) {
      case "keep":
        return Option.none();

      case "clear":
        return Option.some(withoutUpdate(current, machineId));

      case "set":
        return Option.some(withUpdate(current, machineId, decision.update));

      default: {
        const _exhaustive: never = decision;

        return _exhaustive;
      }
    }
  });
}
