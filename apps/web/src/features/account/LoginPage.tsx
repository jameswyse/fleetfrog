import { useId, useRef, useState } from "react";

import { useSearch } from "@tanstack/react-router";

import { signIn, signInWithTailscale, useSession } from "@/rpc/session.ts";
import { Button } from "@/ui/Button.tsx";
import { formText } from "@/ui/formText.ts";
import { FrogMark } from "@/ui/Logo.tsx";
import { Spinner } from "@/ui/Spinner.tsx";
import { TailscaleMark } from "@/ui/TailscaleMark.tsx";
import { localPath } from "@fleetfrog/protocol/dashboard/auth";

import { ProviderButtonContent, providerButtonClass } from "./ProviderButton.tsx";

import type { SignInMethods, TailscaleIdentity } from "@fleetfrog/protocol/dashboard/auth";

const inputClass =
  "min-h-10 w-full rounded-lg border border-line bg-canvas px-3 text-base sm:text-sm aria-invalid:border-danger";

function PasswordForm({ redirect }: { readonly redirect: string }) {
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();
  const email = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();

        const form = new FormData(event.currentTarget);

        setPending(true);
        setError(null);

        const outcome = await signIn({
          email: formText(form, "email"),
          password: formText(form, "password"),
        });

        setPending(false);

        if (outcome._tag === "Failure") {
          setError(outcome.message);
          email.current?.focus();
        } else {
          // A full load, so the page starts clean for whoever signed in.
          window.location.assign(redirect);
        }
      }}
    >
      <div className="space-y-1.5">
        <label htmlFor={emailId} className="block text-sm font-medium">
          Email
        </label>
        <input
          ref={email}
          id={emailId}
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          aria-invalid={error !== null}
          aria-describedby={errorId}
          className={inputClass}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={passwordId} className="block text-sm font-medium">
          Password
        </label>
        <input
          id={passwordId}
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-invalid={error !== null}
          aria-describedby={errorId}
          className={inputClass}
        />
      </div>
      <p id={errorId} role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
      <Button tone="primary" type="submit" disabled={pending} className="min-h-10 w-full">
        {pending && <Spinner />}
        Sign in
      </Button>
    </form>
  );
}

function ProviderButton({
  provider,
  redirect,
}: {
  readonly provider: NonNullable<SignInMethods["provider"]>;
  readonly redirect: string;
}) {
  return (
    <a
      href={`/auth/oidc/start?${new URLSearchParams({ redirect }).toString()}`}
      className={providerButtonClass}
    >
      <ProviderButtonContent name={provider.name} icon={provider.icon} />
    </a>
  );
}

/** Signs in as whoever Tailscale says opened the dashboard, which needs no typing. */
function TailscaleButton({
  identity,
  redirect,
}: {
  readonly identity: TailscaleIdentity;
  readonly redirect: string;
}) {
  const errorId = useId();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        aria-describedby={errorId}
        className={providerButtonClass}
        onClick={async () => {
          setPending(true);
          setError(null);

          const outcome = await signInWithTailscale();

          if (outcome._tag === "Failure") {
            setPending(false);
            setError(outcome.message);
          } else {
            // A full load, so the page starts clean for whoever signed in.
            window.location.assign(redirect);
          }
        }}
      >
        {pending ? <Spinner /> : <TailscaleMark className="size-5" />}
        Continue as {identity.name}
      </button>
      <p className="text-center text-xs text-ink-muted">
        Signed in to Tailscale as {identity.login}
      </p>
      <p id={errorId} role="alert" className="text-sm text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}

function SignInCard({
  methods,
  redirect,
  failure,
}: {
  readonly methods: SignInMethods;
  readonly redirect: string;
  readonly failure: string | undefined;
}) {
  const tailscale = methods.tailscale?.identity ?? null;

  return (
    <div className="rise-in space-y-5 rounded-2xl bg-surface p-6 shadow-[0_0_0_1px_var(--line),0_1px_2px_oklch(0_0_0/0.04),0_12px_32px_-8px_oklch(0_0_0/0.12)] [animation-delay:200ms] sm:p-8">
      {failure !== undefined && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      {tailscale !== null && <TailscaleButton identity={tailscale} redirect={redirect} />}
      {methods.provider !== null && (
        <ProviderButton provider={methods.provider} redirect={redirect} />
      )}
      {(methods.provider !== null || tailscale !== null) && methods.passwords && (
        <p className="flex items-center gap-3 text-xs text-ink-muted">
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
          or
          <span aria-hidden="true" className="h-px flex-1 bg-line" />
        </p>
      )}
      {methods.passwords && <PasswordForm redirect={redirect} />}
      {methods.tailscale !== null && methods.tailscale.identity === null && (
        <p className="text-sm text-ink-muted">
          To sign in with Tailscale, open the dashboard at its Tailscale address on a device signed
          in to Tailscale.
        </p>
      )}
    </div>
  );
}

/** The whole page for anyone signed out, with the frog front and centre. */
export function LoginPage() {
  // `failure` is why the last sign-in through the provider didn't work, from the hub's redirect.
  const { redirect, failure } = useSearch({ from: "/login" });
  const session = useSession();
  const target = localPath(redirect);

  if (session._tag !== "Known" || session.session._tag !== "SignedOut") {
    return null;
  }

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-16">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(48rem_32rem_at_50%_18%,color-mix(in_oklab,var(--logo-frog)_16%,transparent),transparent_70%)]"
      />
      <div className="w-full max-w-sm">
        <FrogMark className="rise-in mx-auto h-auto w-40 drop-shadow-[0_12px_24px_color-mix(in_oklab,var(--logo-frog)_35%,transparent)]" />
        <h1 className="rise-in mt-8 text-center text-2xl font-semibold tracking-tight text-balance [animation-delay:100ms]">
          Sign in to FleetFrog
        </h1>
        <div className="mt-8">
          <SignInCard methods={session.session.methods} redirect={target} failure={failure} />
        </div>
      </div>
    </main>
  );
}
