import { useSyncExternalStore } from "react";

export type ColorScheme = "system" | "light" | "dark";

/** How this browser shows the dashboard. Each browser keeps its own, whoever signs in. */
export interface Preferences {
  readonly colorScheme: ColorScheme;
  /** Blurs whatever `data-personal` marks, for people who share their screen. */
  readonly blurPersonal: boolean;
}

/*
 * The script in `index.html` reads these keys too, to apply them before the page first paints, so
 * a change to their names or values has to change it as well.
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
    // The preference still applies until the page closes.
  }
}

function load(): Preferences {
  const colorScheme = readItem(colorSchemeKey);

  return {
    colorScheme: colorScheme === "light" || colorScheme === "dark" ? colorScheme : "system",
    blurPersonal: readItem(blurPersonalKey) === "on",
  };
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

let preferences = load();
const listeners = new Set<() => void>();

function set(next: Preferences): void {
  preferences = next;
  apply(next);

  for (const listener of listeners) {
    listener();
  }
}

// Another tab changed them, so this one follows.
window.addEventListener("storage", (event) => {
  if (event.key === null || event.key === colorSchemeKey || event.key === blurPersonalKey) {
    set(load());
  }
});

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, () => preferences);
}

export function setColorScheme(colorScheme: ColorScheme): void {
  writeItem(colorSchemeKey, colorScheme === "system" ? null : colorScheme);
  set({ ...preferences, colorScheme });
}

export function setBlurPersonal(blurPersonal: boolean): void {
  writeItem(blurPersonalKey, blurPersonal ? "on" : null);
  set({ ...preferences, blurPersonal });
}
