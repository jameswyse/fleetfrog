import type { ReactNode } from "react";

/** A labelled group of rows in one card, with room beside the label for how saving went. */
export function SettingsSection({
  title,
  status,
  children,
}: {
  readonly title: string;
  readonly status?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between gap-4 px-1">
        <h2 className="text-sm text-ink-muted">{title}</h2>
        {status}
      </div>
      <div className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
        {children}
      </div>
    </section>
  );
}

/**
 * One setting: what it is on the leading side and its control on the trailing side, with room
 * below for anything wider, such as a list or an error.
 */
export function SettingsRow({
  title,
  description,
  htmlFor,
  control,
  children,
}: {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  /** Makes the title the label of this input. */
  readonly htmlFor?: string;
  readonly control?: ReactNode;
  readonly children?: ReactNode;
}) {
  const Title = htmlFor === undefined ? "p" : "label";

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4">
      <div className="min-w-0 flex-1 basis-64">
        <Title htmlFor={htmlFor} className="block text-sm font-medium">
          {title}
        </Title>
        {description !== undefined && (
          <p
            id={htmlFor === undefined ? undefined : `${htmlFor}-description`}
            className="mt-0.5 text-sm text-ink-muted"
          >
            {description}
          </p>
        )}
      </div>
      {control !== undefined && <div className="shrink-0">{control}</div>}
      {children !== undefined && <div className="basis-full">{children}</div>}
    </div>
  );
}

/** A compact card of facts for the side column: each term above its value. */
export function SidePanel({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm text-ink-muted">{title}</h2>
      <dl className="space-y-3 rounded-xl border border-line bg-surface px-4 py-4">{children}</dl>
    </section>
  );
}

export function SideDetail({
  term,
  children,
}: {
  readonly term: string;
  readonly children: ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{term}</dt>
      <dd className="mt-0.5 text-sm break-words">{children}</dd>
    </div>
  );
}
