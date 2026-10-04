import { useSyncExternalStore } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { onSessionChange } from "@/rpc/session.ts";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Preferences } from "@fleetfrog/protocol/domain/preferences";

const colorSchemeKey = "fleetfrog.colorScheme";
const blurPersonalKey = "fleetfrog.blurPersonal";

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {}
}

function loadCopy(): Preferences {
  const colorScheme = readItem(colorSchemeKey);

  return {
    colorScheme: colorScheme === "light" || colorScheme === "dark" ? colorScheme : "system",
    blurPersonal: readItem(blurPersonalKey) === "on",
  };
}

function saveCopy({ colorScheme, blurPersonal }: Preferences): void {
  writeItem(colorSchemeKey, colorScheme === "system" ? null : colorScheme);
  writeItem(blurPersonalKey, blurPersonal ? "on" : null);
}

function apply({ colorScheme, blurPersonal }: Preferences): void {
  const root = document.documentElement;

  if (colorScheme === "system") {
    root.removeAttribute("data-color-scheme");
  } else {
    root.dataset.colorScheme = colorScheme;
  }

  root.toggleAttribute("data-blur-personal", blurPersonal);
}

let preferences = loadCopy();
const listeners = new Set<() => void>();

function show(next: Preferences): void {
  if (
    next.colorScheme === preferences.colorScheme &&
    next.blurPersonal === preferences.blurPersonal
  ) {
    return;
  }

  preferences = next;
  apply(next);

  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function startPreferences(): void {
  onSessionChange((state) => {
    if (state._tag === "Known" && state.session._tag !== "SignedOut") {
      saveCopy(state.session.preferences);
      show(state.session.preferences);
    }
  });

  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === colorSchemeKey || event.key === blurPersonalKey) {
      show(loadCopy());
    }
  });
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => preferences);
}

export function changePreferences(change: Partial<Preferences>): Promise<HubResult<void>> {
  const next = { ...preferences, ...change };

  saveCopy(next);
  show(next);

  return requestHub((client) => client.SetPreferences({ preferences: next }));
}
