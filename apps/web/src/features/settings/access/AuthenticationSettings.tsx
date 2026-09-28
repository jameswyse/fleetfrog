import { useState } from "react";

import { useSearch } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { requestHub } from "@/rpc/hubConnection.ts";
import { changeMode, useSession } from "@/rpc/session.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formText } from "@/ui/formText.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { ModeChange } from "@fleetfrog/protocol/dashboard/auth";
import { minimumPasswordLength, OidcInput } from "@fleetfrog/protocol/domain/user";

import { SettingsRow, SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";
import { TextField } from "./TextField.tsx";
import { checkFields, messageFor } from "./userForm.ts";

import type { AuthMode, AuthSettingsView } from "@fleetfrog/protocol/domain/user";

import type { FieldError } from "./userForm.ts";

const decodeModeChange = Schema.decodeUnknownOption(ModeChange);

/** Turns password sign-in on, with the admin's own account so they stay signed in. */
function TurnOnPasswordsDialog({ onClose }: { readonly onClose: () => void }) {
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
          const change = decodeModeChange({
            _tag: "Local",
            email: formText(values, "email"),
            displayName: formText(values, "displayName").trim(),
            password: formText(values, "password"),
          });

          setErrors(found);

          if (found.length > 0 || Option.isNone(change)) {
            return;
          }

          setPending(true);
          setFailure(null);

          const outcome = await changeMode(change.value);

          setPending(false);

          if (outcome._tag === "Failure") {
            setFailure(outcome.message);
          } else {
            onClose();
          }
        }}
      >
        <p>
          People will sign in with an email address and password. Set yours now, so you stay signed
          in as an admin. Everyone else is signed out, and you can add accounts for them under
          Users.
        </p>
        <TextField
          label="Your name"
          name="displayName"
          autoComplete="name"
          defaultValue={me?.displayName}
          error={messageFor(errors, "displayName")}
        />
        <TextField
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

              const outcome = await changeMode({ _tag: "None" });

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

function modeOptions(settings: AuthSettingsView): ReadonlyArray<{
  readonly mode: AuthMode;
  readonly title: string;
  readonly description: string;
  readonly available: boolean;
}> {
  return [
    {
      mode: "none",
      title: "Off",
      description:
        "Anyone who can reach the dashboard can use all of it. For a private network, or behind a proxy that signs people in, such as Pangolin.",
      available: true,
    },
    {
      mode: "local",
      title: "Email and password",
      description: "People sign in with the accounts under Users.",
      available: true,
    },
    {
      mode: "oidc",
      title: "Sign-in provider",
      description:
        settings.oidc === null
          ? "People sign in through an OpenID Connect provider such as Authentik. Set one up below first."
          : `People sign in through ${settings.oidc.providerName}.`,
      available: settings.oidc !== null,
    },
  ];
}

/** Turning the provider on starts with the admin signing in through it, which proves it works. */
function TurnOnProviderDialog({
  providerName,
  onClose,
}: {
  readonly providerName: string;
  readonly onClose: () => void;
}) {
  return (
    <Dialog title={`Sign in through ${providerName}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          You'll sign in at {providerName} to check it works. When you're back, people sign in
          through {providerName}, everyone else is signed out and you stay an admin.
        </p>
        <p className="text-ink-muted">
          Someone whose email matches an account here takes that account over when they first sign
          in, keeping its role.
        </p>
        <div className="flex justify-end gap-3">
          <Button onClick={onClose}>Cancel</Button>
          <a
            href="/auth/oidc/start?intent=activate"
            className="inline-flex min-h-9 items-center justify-center rounded-md bg-accent px-3 text-sm font-medium text-accent-ink hover:bg-accent-hover"
          >
            Sign in with {providerName}
          </a>
        </div>
      </div>
    </Dialog>
  );
}

function ModeChoice({ settings }: { readonly settings: AuthSettingsView }) {
  const [changing, setChanging] = useState<AuthMode | null>(null);

  return (
    <SettingsSection title="How people sign in">
      <fieldset disabled={settings.overridden}>
        <legend className="sr-only">How people sign in</legend>
        {modeOptions(settings).map(({ mode, title, description, available }) => (
          <label
            key={mode}
            className="flex cursor-pointer items-start gap-3 border-line px-5 py-4 not-first-of-type:border-t hover:bg-surface-raised has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="radio"
              name="mode"
              value={mode}
              checked={settings.mode === mode}
              disabled={!available}
              onChange={() => setChanging(mode)}
              className="mt-0.5 size-4 accent-accent"
            />
            <span>
              <span className="block text-sm font-medium">{title}</span>
              <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {changing === "none" && <TurnOffDialog onClose={() => setChanging(null)} />}
      {changing === "local" && <TurnOnPasswordsDialog onClose={() => setChanging(null)} />}
      {changing === "oidc" && settings.oidc !== null && (
        <TurnOnProviderDialog
          providerName={settings.oidc.providerName}
          onClose={() => setChanging(null)}
        />
      )}
    </SettingsSection>
  );
}

const decodeOidcInput = Schema.decodeUnknownOption(OidcInput);

/** Which fields need something in them, in the order they're shown. */
const requiredProviderFields = [
  ["providerName", "Enter a name for the sign-in button."],
  ["issuerUrl", "Enter the issuer URL, starting with https://."],
  ["clientId", "Enter the client ID."],
  ["dashboardUrl", "Enter the dashboard's URL, starting with https://."],
] as const;

function ProviderSection({ settings }: { readonly settings: AuthSettingsView }) {
  const saved = settings.oidc;
  const [dashboardUrl, setDashboardUrl] = useState(saved?.dashboardUrl ?? window.location.origin);
  const [errors, setErrors] = useState<ReadonlyArray<{ field: string; message: string }>>([]);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;
  const callback = URL.canParse(dashboardUrl)
    ? new URL("/auth/oidc/callback", dashboardUrl).href
    : null;

  return (
    <SettingsSection title="Sign-in provider">
      <form
        noValidate
        className="space-y-4 px-5 py-4"
        onSubmit={async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const values = new FormData(form);
          const optional = (name: string) => formText(values, name).trim() || null;
          const input = decodeOidcInput({
            providerName: formText(values, "providerName"),
            issuerUrl: formText(values, "issuerUrl"),
            clientId: formText(values, "clientId"),
            clientSecret: formText(values, "clientSecret") || null,
            dashboardUrl: formText(values, "dashboardUrl"),
            adminGroup: optional("adminGroup"),
            requiredGroup: optional("requiredGroup"),
          });
          const found = requiredProviderFields.flatMap(([field, message]) => {
            const value = formText(values, field).trim();
            const url = field === "issuerUrl" || field === "dashboardUrl";

            return value === "" || (url && !URL.canParse(value)) ? [{ field, message }] : [];
          });
          const first = found[0] === undefined ? null : form.elements.namedItem(found[0].field);

          setErrors(found);
          setResult(null);

          if (first instanceof HTMLInputElement) {
            first.focus();
          }

          if (found.length > 0 || Option.isNone(input)) {
            return;
          }

          setPending(true);

          const outcome = await requestHub((client) =>
            client.SetOidcSettings({ settings: input.value }),
          );

          setPending(false);
          setResult(
            outcome._tag === "Success"
              ? { ok: true, message: "Saved. The provider answered." }
              : { ok: false, message: outcome.message },
          );

          if (outcome._tag === "Success") {
            const secret = form.elements.namedItem("clientSecret");

            if (secret instanceof HTMLInputElement) {
              secret.value = "";
            }
          }
        }}
      >
        <p className="text-sm text-ink-muted">
          Create an OAuth2/OpenID application for FleetFrog at your provider, such as Authentik,
          then copy its details here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Provider name"
            name="providerName"
            autoComplete="off"
            defaultValue={saved?.providerName ?? ""}
            placeholder="Authentik"
            hint="Shown on the sign-in button."
            error={errorFor("providerName")}
          />
          <TextField
            label="Issuer URL"
            name="issuerUrl"
            type="url"
            autoComplete="off"
            defaultValue={saved?.issuerUrl ?? ""}
            placeholder="https://auth.example.com/application/o/fleetfrog/"
            hint="FleetFrog reads the provider's details from here."
            error={errorFor("issuerUrl")}
          />
          <TextField
            label="Client ID"
            name="clientId"
            autoComplete="off"
            defaultValue={saved?.clientId ?? ""}
            error={errorFor("clientId")}
          />
          <TextField
            label="Client secret"
            name="clientSecret"
            type="password"
            autoComplete="off"
            placeholder={saved === null ? "" : "Saved"}
            hint={saved === null ? undefined : "Leave it empty to keep the saved one."}
          />
          <TextField
            label="Dashboard URL"
            name="dashboardUrl"
            type="url"
            autoComplete="off"
            value={dashboardUrl}
            onChange={(event) => setDashboardUrl(event.currentTarget.value)}
            hint="Where people open FleetFrog, which the provider sends them back to."
            error={errorFor("dashboardUrl")}
          />
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">Redirect URI</p>
            <p className="min-h-9 rounded-md border border-line bg-surface-raised px-2.5 py-2 font-mono text-[13px] break-all select-all">
              {callback ?? "Enter the dashboard URL first."}
            </p>
            <p className="text-ink-muted">Register this at the provider.</p>
          </div>
          <TextField
            label="Admin group (optional)"
            name="adminGroup"
            autoComplete="off"
            defaultValue={saved?.adminGroup ?? ""}
            hint="Members are admins and everyone else is a user, checked at each sign-in. Leave it empty to set roles under Users."
          />
          <TextField
            label="Required group (optional)"
            name="requiredGroup"
            autoComplete="off"
            defaultValue={saved?.requiredGroup ?? ""}
            hint="Only members can sign in. Leave it empty to let in anyone the provider signs in."
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm empty:hidden">
            {result !== null && (
              <span className={result.ok ? "text-clean" : "text-danger"}>{result.message}</span>
            )}
          </p>
          <Button tone="primary" type="submit" disabled={pending} className="ms-auto">
            {pending ? "Checking…" : "Save"}
          </Button>
        </div>
      </form>
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

/** How people sign in to the dashboard, for admins. */
export function AuthenticationSettings() {
  // Set by the hub when a test sign-in through the provider didn't work.
  const { failure } = useSearch({ from: "/_app/settings/authentication" });
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
          {failure !== undefined && (
            <p
              role="alert"
              className="rounded-xl border border-danger/30 bg-danger-soft px-5 py-4 text-sm text-danger"
            >
              Sign-in through the provider is still off. {failure}
            </p>
          )}
          <ModeChoice settings={settings.value} />
          <ProviderSection settings={settings.value} />
          <GravatarSection settings={settings.value} />
        </>
      )}
    </SidebarPage>
  );
}
