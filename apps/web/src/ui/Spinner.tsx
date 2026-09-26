/** A small busy indicator. It spins only when motion is welcome and is always hidden from screen readers. */
export function Spinner({ className = "" }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block size-3 shrink-0 rounded-full border-2 border-current border-e-transparent opacity-70 motion-safe:animate-spin ${className}`}
    />
  );
}
