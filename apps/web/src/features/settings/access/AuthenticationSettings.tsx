import { useState } from "react";

import { Link, useSearch } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { signInFailureMessage } from "@/features/account/signInFailures.ts";
import { requestHub } from "@/rpc/hubConnection.ts";
import { changeMethods, useSession } from "@/rpc/session.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formText } from "@/ui/formText.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { MethodChange } from "@fleetfrog/protocol/dashboard/auth";
import { isSignInOn, minimumPasswordLength } from "@fleetfrog/protocol/domain/user";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";
import { TextField } from "./TextField.tsx";
import { checkFields, messageFor } from "./userForm.ts";

import type { AuthSettingsView } from "@fleetfrog/protocol/domain/user";

import type { FieldError } from "./userForm.ts";

const decodeMethodChange = Schema.decodeUnknownOption(MethodChange);

function TurnOnPasswordsDialog({
  signInOn,
  onClose,
}: {
  readonly signInOn: boolean;
  readonly onClose: () => void;
}) {
  const session = useSession();

  const me =
    session._tag === "Known" && session.session._tag === "SignedIn" ? session.session.user : null;

  const [errors, setErrors] = useState<ReadonlyArray<FieldError>>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title="Turn on password sign-in" onClose={onClose}>
      <form
        noValidate
        className="space-y-4 text-sm"
        onSubmit={async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const values = new FormData(form);
          const found = checkFields(form, ["displayName", "email", "password", "confirm"]);

          const change = decodeMethodChange({
            _tag: "EnablePasswords",
            email: formText(values, "email"),
            displayName: formText(values, "displayName").trim(),
            password: formText(values, "password"),
          });

          setErrors(found);

          if (found.length > 0) {
            return;
          }

          if (Option.isNone(change)) {
            setFailure(
              "Check the details: a name is at most 80 characters, a password at most 256.",
            );

            return;
          }

          setPending(true);
          setFailure(null);

          const outcome = await changeMethods(change.value);

          setPending(false);

          if (outcome._tag === "Failure") {
            setFailure(outcome.message);
          } else {
            onClose();
          }
        }}
      >
        <p>
          {signInOn
            ? "People can also sign in with an email address and password. Set yours now, and add accounts for others under Users."
            : "People will sign in with an email address and password. Set yours now, so you stay signed in as an admin. Everyone else is signed out, and you can add accounts for them under Users."}
        </p>
        <TextField
          label="Your name"
          name="displayName"
          autoComplete="name"
          defaultValue={me?.displayName}
          error={messageFor(errors, "displayName")}
        />
        <TextField
          data-personal
          label="Your email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          defaultValue={me?.email}
          hint="If a user already has this email, that account becomes yours and an admin."
          error={messageFor(errors, "email")}
        />
        <TextField
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${minimumPasswordLength} characters.`}
          error={messageFor(errors, "password")}
        />
        <TextField
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          error={messageFor(errors, "confirm")}
        />
        <p role="status" className="text-danger empty:hidden">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit" disabled={pending}>
            {pending ? "Turning on…" : "Turn on"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function TurnOffDialog({ onClose }: { readonly onClose: () => void }) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title="Turn off sign-in?" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          Anyone who can reach the dashboard will be able to use all of it, including Cleanup and
          Settings. Do this only on a private network, or behind a proxy that signs people in.
        </p>
        <p className="text-ink-muted">Accounts stay, ready for when you turn sign-in back on.</p>
        <p role="status" className="text-danger empty:hidden">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);

              const outcome = await changeMethods({ _tag: "TurnOff" });

              setPending(false);

              if (outcome._tag === "Failure") {
                setFailure(outcome.message);
              } else {
                onClose();
              }
            }}
          >
            {pending ? "Turning off…" : "Turn off sign-in"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

type TurningOff = "DisablePasswords" | "DisableProvider" | "DisableTailscale";

function TurnOffMethodDialog({
  change,
  settings,
  onClose,
}: {
  readonly change: TurningOff;
  readonly settings: AuthSettingsView;
  readonly onClose: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const providerName = settings.oidc?.providerName ?? "the provider";

  const method = {
    DisablePasswords: { name: "passwords", phrase: "with a password" },
    DisableProvider: { name: "OpenID Connect", phrase: `through ${providerName}` },
    DisableTailscale: { name: "Tailscale sign-in", phrase: "through Tailscale" },
  } as const;

  const remaining = (
    [
      settings.passwords && "DisablePasswords",
      settings.provider && "DisableProvider",
      settings.tailscale && "DisableTailscale",
    ] as const
  ).filter((other): other is TurningOff => other !== false && other !== change);

  return (
    <Dialog title={`Turn off ${method[change].name}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          People can sign in only {remaining.map((other) => method[other].phrase).join(" or ")}.
          {change === "DisablePasswords" &&
            " Passwords stay, ready for when you turn them back on."}{" "}
          Everyone else is signed out.
        </p>
        <p role="status" className="text-danger empty:hidden">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="danger"
            disabled={pending}
            onClick={async () => {
              setPending(true);

              const outcome = await changeMethods({ _tag: change });

              setPending(false);

              if (outcome._tag === "Failure") {
                setFailure(outcome.message);
              } else {
                onClose();
              }
            }}
          >
            Turn off {method[change].name}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function TurnOnTailscaleDialog({
  signInOn,
  onClose,
}: {
  readonly signInOn: boolean;
  readonly onClose: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title="Turn on Tailscale sign-in?" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          People on your tailnet sign in as their Tailscale account, which becomes a FleetFrog user
          the first time. Your Tailscale account becomes an admin, and you're signed in with it.
          {!signInOn && " Everyone else has to sign in."}
        </p>
        <p role="status" className="text-danger empty:hidden">
          {failure}
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            tone="primary"
            disabled={pending}
            onClick={async () => {
              setPending(true);

              const outcome = await changeMethods({ _tag: "EnableTailscale" });

              setPending(false);

              if (outcome._tag === "Failure") {
                setFailure(outcome.message);
              } else {
                onClose();
              }
            }}
          >
            {pending ? "Turning on…" : "Turn on"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function SignInThroughProviderDialog({
  providerName,
  onClose,
}: {
  readonly providerName: string;
  readonly onClose: () => void;
}) {
  return (
    <Dialog title={`Sign in with ${providerName}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          Sign-in is off, so OpenID Connect turns on once you've signed in through {providerName},
          which checks it works. Then everyone has to sign in, and you stay an admin.
        </p>
        <form method="post" action="/auth/oidc/activate" className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button tone="primary" type="submit">
            Sign in with {providerName}
          </Button>
        </form>
      </div>
    </Dialog>
  );
}

type Asking =
  | "TurnOnPasswords"
  | "TurnOnTailscale"
  | "TurnOff"
  | TurningOff
  | "SignInThroughProvider";

function MethodsSection({ settings }: { readonly settings: AuthSettingsView }) {
  const { state, save } = useAutoSave();
  const [asking, setAsking] = useState<Asking | null>(null);
  const [providerWanted, setProviderWanted] = useState(false);
  const signInOn = isSignInOn(settings);
  const providerName = settings.oidc?.providerName ?? "the provider";

  const turnOff = (change: TurningOff, othersOn: boolean) =>
    setAsking(othersOn ? change : "TurnOff");

  const switchProvider = (on: boolean) => {
    if (!on) {
      if (providerWanted) {
        setProviderWanted(false);
      } else {
        turnOff("DisableProvider", settings.passwords || settings.tailscale);
      }

      return;
    }

    if (settings.oidc === null) {
      setProviderWanted(true);
    } else if (signInOn) {
      void save(async () => {
        const outcome = await changeMethods({ _tag: "EnableProvider" });

        return outcome._tag === "Failure"
          ? outcome
          : { _tag: "Success" as const, value: undefined };
      });
    } else {
      setAsking("SignInThroughProvider");
    }
  };

  return (
    <SettingsSection title="Sign-in methods" status={<SaveStatus state={state} />}>
      <SettingsRow
        title="Email and password"
        description="People sign in with an account under Users."
        htmlFor="passwords"
        control={
          <Switch
            id="passwords"
            aria-describedby="passwords-description"
            checked={settings.passwords}
            disabled={settings.overridden}
            onChange={(on) =>
              on
                ? setAsking("TurnOnPasswords")
                : turnOff("DisablePasswords", settings.provider || settings.tailscale)
            }
          />
        }
      />
      <SettingsRow
        title="OpenID Connect"
        description={
          settings.oidc === null
            ? "People sign in through a provider such as Authentik."
            : `People sign in through ${settings.oidc.providerName}.`
        }
        htmlFor="provider"
        control={
          <div className="flex items-center gap-4">
            {settings.oidc !== null && (
              <Link
                to="/settings/authentication/oidc"
                className="text-sm text-accent-text underline-offset-2 hover:underline"
              >
                Settings
              </Link>
            )}
            <Switch
              id="provider"
              aria-describedby="provider-description"
              checked={settings.provider || providerWanted}
              disabled={settings.overridden}
              onChange={switchProvider}
            />
          </div>
        }
      >
        {providerWanted && settings.oidc === null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-changes/30 bg-changes-soft px-4 py-3 text-sm text-changes">
            <p>OpenID Connect needs setting up before it can turn on.</p>
            <Link
              to="/settings/authentication/oidc"
              search={{ enable: true }}
              className="inline-flex min-h-8 items-center rounded-md bg-accent px-3 font-medium text-accent-ink hover:bg-accent-hover"
            >
              Set up
            </Link>
          </div>
        )}
      </SettingsRow>
      {(settings.tailscaleAvailable || settings.tailscale) && (
        <SettingsRow
          title="Tailscale"
          description={
            settings.tailscaleAvailable
              ? "People on your tailnet sign in as their Tailscale account, when they open the dashboard at its Tailscale address."
              : "Tailscale Serve no longer fronts the hub, so nobody can sign in this way."
          }
          htmlFor="tailscale"
          control={
            <Switch
              id="tailscale"
              aria-describedby="tailscale-description"
              checked={settings.tailscale}
              disabled={settings.overridden}
              onChange={(on) =>
                on
                  ? setAsking("TurnOnTailscale")
                  : turnOff("DisableTailscale", settings.passwords || settings.provider)
              }
            />
          }
        />
      )}
      {asking === "TurnOnPasswords" && (
        <TurnOnPasswordsDialog signInOn={signInOn} onClose={() => setAsking(null)} />
      )}
      {asking === "TurnOff" && <TurnOffDialog onClose={() => setAsking(null)} />}
      {asking === "TurnOnTailscale" && (
        <TurnOnTailscaleDialog signInOn={signInOn} onClose={() => setAsking(null)} />
      )}
      {(asking === "DisablePasswords" ||
        asking === "DisableProvider" ||
        asking === "DisableTailscale") && (
        <TurnOffMethodDialog change={asking} settings={settings} onClose={() => setAsking(null)} />
      )}
      {asking === "SignInThroughProvider" && (
        <SignInThroughProviderDialog providerName={providerName} onClose={() => setAsking(null)} />
      )}
    </SettingsSection>
  );
}

function GravatarSection({ settings }: { readonly settings: AuthSettingsView }) {
  const { state, save } = useAutoSave();

  return (
    <SettingsSection title="Pictures" status={<SaveStatus state={state} />}>
      <SettingsRow
        title="Gravatar"
        description="Users without a picture get their Gravatar. Each viewer's browser sends Gravatar a hash of the user's email to fetch it."
        htmlFor="gravatar"
        control={
          <Switch
            id="gravatar"
            aria-describedby="gravatar-description"
            checked={settings.gravatar}
            onChange={(enabled) =>
              void save(() => requestHub((client) => client.SetGravatar({ enabled })))
            }
          />
        }
      />
    </SettingsSection>
  );
}

export function AuthenticationSettings() {
  const failure = signInFailureMessage(
    useSearch({ from: "/_app/settings/authentication/" }).failure,
  );

  const settings = useHubStream({ key: "auth", open: (client) => client.WatchAuthSettings() });

  return (
    <SidebarPage title="Authentication">
      {settings._tag === "Loading" && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {settings._tag === "Failed" && (
        <p className="py-16 text-center text-sm text-danger">{settings.message}</p>
      )}
      {settings._tag === "Ready" && (
        <>
          {settings.value.overridden && (
            <p className="rounded-xl border border-changes/30 bg-changes-soft px-5 py-4 text-sm text-changes">
              FLEETFROG_AUTH_MODE=none on the hub keeps sign-in off. Remove it and restart the hub
              to choose here.
            </p>
          )}
          {failure !== null && (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-4 text-sm text-danger"
            >
              OpenID Connect is still off. {failure}
            </p>
          )}
          <MethodsSection settings={settings.value} />
          <GravatarSection settings={settings.value} />
        </>
      )}
    </SidebarPage>
  );
}
