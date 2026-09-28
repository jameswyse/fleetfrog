import { useSyncExternalStore } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { onSessionChange } from "@/rpc/session.ts";

import type { HubResult } from "@/rpc/hubConnection.ts";
import type { Preferences } from "@fleetfrog/protocol/domain/preferences";

/*
 * The hub keeps each user's preferences, and the browser keeps a copy of the last ones it saw, so
 * they apply before the hub answers. The script in `index.html` reads these keys to apply them
 * before the page first paints, so a change to their names or values has to change it as well.
 */
const colorSchemeKey = "fleetfrog.colorScheme";
const blurPersonalKey = "fleetfrog.blurPersonal";

/** Browsers that block site data throw on any use of storage. */
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
  } catch {
    // The hub still has them, so the next page load applies them once it answers.
  }
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

/** Sets the attributes `styles.css` switches on: none means the system's colours and no blur. */
function apply({ colorScheme, blurPersonal }: Preferences): void {
  const root = document.documentElement;

  if (colorScheme === "system") {
    delete root.dataset.colorScheme;
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

/** Follows the preferences the hub has for whoever is signed in, and those other tabs save. */
export function startPreferences(): void {
  onSessionChange((state) => {
    // Signed out, the page keeps the last ones it saw.
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

/**
 * Applies the change at once and saves it for the signed-in user, or for everyone while sign-in is
 * off. If the save fails, the change lasts until the page next hears from the hub.
 */
export function changePreferences(change: Partial<Preferences>): Promise<HubResult<void>> {
  const next = { ...preferences, ...change };

  saveCopy(next);
  show(next);

  return requestHub((client) => client.SetPreferences({ preferences: next }));
}
