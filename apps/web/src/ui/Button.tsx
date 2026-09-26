import type { ButtonHTMLAttributes } from "react";

const tones = {
  primary: "bg-accent text-accent-ink hover:brightness-110",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-raised",
  danger: "border border-danger/40 bg-danger-soft text-danger hover:border-danger",
  quiet: "text-ink-muted hover:bg-surface-raised hover:text-ink",
} as const;

export function Button({
  tone = "secondary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly tone?: keyof typeof tones }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${tones[tone]} ${className}`}
      {...props}
    />
  );
}
