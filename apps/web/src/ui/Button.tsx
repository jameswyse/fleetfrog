import type { ButtonHTMLAttributes } from "react";

const tones = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-raised",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
  quiet: "text-ink-muted hover:bg-surface-raised hover:text-ink",
} as const;

const sizes = {
  regular: "min-h-9 px-3 text-sm",
  compact: "min-h-8 px-2.5 text-[13px]",
} as const;

export function Button({
  tone = "secondary",
  size = "regular",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly tone?: keyof typeof tones;
  readonly size?: keyof typeof sizes;
}) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${sizes[size]} ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
