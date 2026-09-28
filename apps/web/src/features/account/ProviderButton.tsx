import { LogInIcon } from "lucide-react";

/** The look of the button that signs in through the provider, neutral so its icon stands out. */
export const providerButtonClass =
  "inline-flex min-h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink shadow-[0_1px_2px_oklch(0_0_0/0.05)] hover:bg-surface-raised";

/** The provider's icon, or a generic one when it has none, and its name. */
export function ProviderButtonContent({
  name,
  icon,
}: {
  readonly name: string;
  /** The icon's id, served from `/auth/provider-icon/:id`. */
  readonly icon: string | null;
}) {
  return (
    <>
      {icon === null ? (
        <LogInIcon aria-hidden="true" className="text-ink-muted" />
      ) : (
        <img src={`/auth/provider-icon/${icon}`} alt="" className="size-5 object-contain" />
      )}
      Sign in with {name}
    </>
  );
}
