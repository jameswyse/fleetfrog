import { useState } from "react";

import type { ComponentType, ReactNode } from "react";

const tones = {
  changes: { header: "bg-changes-soft", icon: "bg-changes text-surface" },
  sync: { header: "bg-sync-soft", icon: "bg-sync text-surface" },
  danger: { header: "bg-danger-soft", icon: "bg-danger text-surface" },
  neutral: { header: "bg-canvas", icon: "bg-ink-muted text-surface" },
} as const;

export type SectionTone = keyof typeof tones;

export function PanelSection({
  title,
  icon: Icon,
  tone,
  count,
  children,
}: {
  readonly title: string;
  readonly icon: ComponentType<{ readonly className?: string }>;
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

export function ShortList<Item>({
  items,
  total,
  render,
  noun,
  listClassName = "space-y-1",
}: {
  readonly items: ReadonlyArray<Item>;
  readonly total: number;
  readonly render: (item: Item) => ReactNode;
  readonly noun: string;
  readonly listClassName?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const limit = 8;
  const shown = expanded ? items : items.slice(0, limit);

  return (
    <>
      <ul className={listClassName}>{shown.map(render)}</ul>
      {!expanded && items.length > limit && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-2 text-sm text-accent-text underline-offset-2 hover:underline"
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
