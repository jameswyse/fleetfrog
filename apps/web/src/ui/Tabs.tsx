import type { KeyboardEvent, ReactNode } from "react";

export interface Tab<Id extends string> {
  readonly id: Id;
  readonly label: ReactNode;
}

function tabId(base: string, id: string): string {
  return `${base}-tab-${id}`;
}

function panelId(base: string): string {
  return `${base}-panel`;
}

const nextIndex = {
  ArrowRight: (index: number, count: number) => (index + 1) % count,
  ArrowLeft: (index: number, count: number) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index: number, count: number) => count - 1,
} satisfies Record<string, (index: number, count: number) => number>;

function isNavigationKey(key: string): key is keyof typeof nextIndex {
  return Object.hasOwn(nextIndex, key);
}

export function TabList<Id extends string>({
  base,
  label,
  tabs,
  current,
  onChoose,
}: {
  readonly base: string;
  readonly label: string;
  readonly tabs: ReadonlyArray<Tab<Id>>;
  readonly current: Id;
  readonly onChoose: (id: Id) => void;
}) {
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!isNavigationKey(event.key)) {
      return;
    }

    const next = tabs[nextIndex[event.key](index, tabs.length)];

    if (next !== undefined) {
      event.preventDefault();
      onChoose(next.id);
      document.getElementById(tabId(base, next.id))?.focus();
    }
  };

  return (
    <div role="tablist" aria-label={label} className="flex gap-4">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabId(base, tab.id)}
          aria-selected={tab.id === current}
          aria-controls={panelId(base)}
          tabIndex={tab.id === current ? 0 : -1}
          onClick={() => onChoose(tab.id)}
          onKeyDown={(event) => move(event, index)}
          className="-mb-px flex min-h-10 items-center gap-1.5 border-b-2 border-transparent text-sm font-medium text-ink-muted hover:text-ink aria-selected:border-accent aria-selected:text-ink"
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function TabPanel({
  base,
  current,
  children,
}: {
  readonly base: string;
  readonly current: string;
  readonly children: ReactNode;
}) {
  return (
    <div role="tabpanel" id={panelId(base)} aria-labelledby={tabId(base, current)}>
      {children}
    </div>
  );
}
