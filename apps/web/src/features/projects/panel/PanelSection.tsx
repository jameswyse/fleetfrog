import { useState } from "react";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * What a section is about, which colours its header: amber for uncommitted work, blue for branches
 * and syncing, red for problems, and grey for everything else.
 */
const tones = {
  changes: { header: "bg-changes-soft", icon: "bg-changes text-surface" },
  sync: { header: "bg-sync-soft", icon: "bg-sync text-surface" },
  danger: { header: "bg-danger-soft", icon: "bg-danger text-surface" },
  neutral: { header: "bg-canvas", icon: "bg-ink-muted text-surface" },
} as const;

export type SectionTone = keyof typeof tones;

/** A card in the side panel: a tinted header with an icon, a title and a count, over its content. */
export function PanelSection({
  title,
  icon: Icon,
  tone,
  count,
  children,
}: {
  readonly title: string;
  readonly icon: LucideIcon;
  readonly tone: SectionTone;
  readonly count?: number | string;
  readonly children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <h3
        className={`flex items-center gap-2.5 px-3 py-2 text-sm font-semibold ${tones[tone].header}`}
      >
        <span
          aria-hidden="true"
          className={`grid size-6 shrink-0 place-items-center rounded-md ${tones[tone].icon}`}
        >
          <Icon className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">{title}</span>
        {count !== undefined && (
          <span className="rounded-full bg-surface/80 px-2 text-xs font-medium tabular-nums">
            {count}
          </span>
        )}
      </h3>
      <div className="border-t border-line px-3 py-3">{children}</div>
    </section>
  );
}

/** Labelled facts, the label in a narrow column beside each value. */
export function Facts({ children }: { readonly children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">{children}</dl>
  );
}

export function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{term}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}

/**
 * A list that shows its first few items and the rest on request. `total` counts items the agent
 * left out, which can only be mentioned.
 */
export function ShortList<Item>({
  items,
  total,
  render,
  noun,
}: {
  readonly items: ReadonlyArray<Item>;
  readonly total: number;
  readonly render: (item: Item) => ReactNode;
  /** Names the items in the button, such as "files". */
  readonly noun: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = 8;
  const shown = expanded ? items : items.slice(0, limit);

  return (
    <>
      <ul className="space-y-1">{shown.map(render)}</ul>
      {!expanded && items.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-sm text-sync underline-offset-2 hover:underline"
        >
          Show {items.length - limit} more {noun}
        </button>
      )}
      {(expanded || items.length <= limit) && total > items.length && (
        <p className="mt-2 text-xs text-ink-muted">
          {total - items.length} more {noun} not listed
        </p>
      )}
    </>
  );
}
