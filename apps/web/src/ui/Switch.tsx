export function Switch({
  checked,
  onChange,
  disabled = false,
  ...props
}: {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly "aria-label"?: string;
  readonly "aria-describedby"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-ink-muted transition-colors hover:bg-ink disabled:cursor-not-allowed disabled:opacity-60 aria-checked:bg-accent aria-checked:hover:bg-accent-hover"
      {...props}
    >
      <span
        aria-hidden="true"
        className="ms-1 size-4 rounded-full bg-surface transition-transform group-aria-checked:translate-x-4 group-aria-checked:bg-accent-ink motion-reduce:transition-none rtl:group-aria-checked:-translate-x-4"
      />
    </button>
  );
}
