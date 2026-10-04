import { useId } from "react";

import type { InputHTMLAttributes } from "react";

export function TextField({
  label,
  hint,
  error,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  readonly label: string;
  readonly name: string;
  readonly hint?: string | undefined;
  readonly error?: string | undefined;
}) {
  const id = useId();
  const note = error ?? hint;

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={note === undefined ? undefined : `${id}-note`}
        className="min-h-9 w-full rounded-md border border-line bg-canvas px-2.5 text-sm aria-invalid:border-danger"
        {...input}
      />
      {note !== undefined && (
        <p
          id={`${id}-note`}
          className={`text-sm ${error === undefined ? "text-ink-muted" : "text-danger"}`}
        >
          {note}
        </p>
      )}
    </div>
  );
}
