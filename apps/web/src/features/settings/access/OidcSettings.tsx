import { useRef, useState } from "react";

import { useNavigate, useSearch } from "@tanstack/react-router";
import { Option, Schema } from "effect";

import { requestHub } from "@/rpc/hubConnection.ts";
import { changeMethods } from "@/rpc/session.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Button } from "@/ui/Button.tsx";
import { formText } from "@/ui/formText.ts";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { TextField } from "@/ui/TextField.tsx";
import { isSignInOn, OidcInput } from "@fleetfrog/protocol/domain/user";

import { ProviderButtonContent, providerButtonClass } from "../../account/ProviderButton.tsx";
import { SettingsSection } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";

import type { FormEvent } from "react";

import type { AuthSettingsView } from "@fleetfrog/protocol/domain/user";

const decodeOidcInput = Schema.decodeUnknownOption(OidcInput);

const requiredFields = [
  ["providerName", "Enter a name for the sign-in button."],
  ["issuerUrl", "Enter the issuer URL, starting with https://."],
  ["clientId", "Enter the client ID."],
  ["dashboardUrl", "Enter the dashboard's URL, starting with https://."],
] as const;

const maximumIconBytes = 256 * 1024;

function ButtonSection({
  settings,
  name,
}: {
  readonly settings: AuthSettingsView;
  readonly name: string;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const { state, save } = useAutoSave();
  const saving = state._tag === "Saving";

  const upload = (file: File) =>
    save(async () => {
      if (file.size > maximumIconBytes) {
        return { _tag: "Failure" as const, message: "Choose an image under 256 KB." };
      }

      const icon = new Uint8Array(await file.arrayBuffer());

      return requestHub((client) => client.SetProviderIcon({ icon }));
    });

  return (
    <SettingsSection title="Sign-in button" status={<SaveStatus state={state} />}>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-4 px-5 py-4">
        <div aria-hidden="true" className={`${providerButtonClass} pointer-events-none max-w-72`}>
          <ProviderButtonContent
            name={name.trim() || "your provider"}
            icon={settings.icon?.id ?? null}
          />
        </div>
        <div className="min-w-0 flex-1 basis-64 space-y-3">
          <p className="text-sm text-ink-muted">
            {settings.icon?.source === "uploaded"
              ? "Showing the icon you uploaded."
              : "Showing the icon from your provider's website, fetched when you save."}
          </p>
          <div className="flex flex-wrap gap-3">
            <input
              ref={picker}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];

                event.currentTarget.value = "";

                if (file !== undefined) {
                  void upload(file);
                }
              }}
            />
            <Button disabled={saving} onClick={() => picker.current?.click()}>
              Upload an icon…
            </Button>
            {settings.icon?.source === "uploaded" && (
              <Button
                tone="quiet"
                disabled={saving}
                onClick={() =>
                  void save(() => requestHub((client) => client.SetProviderIcon({ icon: null })))
                }
              >
                Use the provider's icon
              </Button>
            )}
          </div>
        </div>
      </div>
    </SettingsSection>
  );
}

function ProviderForm({
  settings,
  turningOn,
}: {
  readonly settings: AuthSettingsView;
  readonly turningOn: boolean;
}) {
  const navigate = useNavigate();
  const saved = settings.oidc;
  const signInOn = isSignInOn(settings);
  const activate = useRef<HTMLFormElement>(null);
  const [name, setName] = useState(saved?.providerName ?? "");
  const [dashboardUrl, setDashboardUrl] = useState(saved?.dashboardUrl ?? window.location.origin);
  const [errors, setErrors] = useState<ReadonlyArray<{ field: string; message: string }>>([]);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const errorFor = (field: string) => errors.find((error) => error.field === field)?.message;

  const callback = URL.canParse(dashboardUrl)
    ? new URL("/auth/oidc/callback", dashboardUrl).href
    : null;

  const providerLabel = name.trim() || "your provider";
  const saveLabel = turningOn && !signInOn ? `Save and sign in with ${providerLabel}` : "Save";
  const label = turningOn && signInOn ? "Save and turn on" : saveLabel;

  const turnOn = async () => {
    if (!signInOn) {
      activate.current?.requestSubmit();

      return;
    }

    const outcome = await changeMethods({ _tag: "EnableProvider" });

    if (outcome._tag === "Failure") {
      setResult({ ok: false, message: outcome.message });
    } else {
      void navigate({ to: "/settings/authentication" });
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const values = new FormData(form);
    const optional = (field: string) => formText(values, field).trim() || null;

    const input = decodeOidcInput({
      providerName: formText(values, "providerName"),
      issuerUrl: formText(values, "issuerUrl"),
      clientId: formText(values, "clientId"),
      clientSecret: formText(values, "clientSecret") || null,
      dashboardUrl: formText(values, "dashboardUrl"),
      adminGroup: optional("adminGroup"),
      requiredGroup: optional("requiredGroup"),
    });

    const found = requiredFields.flatMap(([field, message]) => {
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

    if (found.length > 0) {
      return;
    }

    if (Option.isNone(input)) {
      setResult({
        ok: false,
        message:
          "Check the details: URLs start with http:// or https://, and the name is at most 80 characters.",
      });

      return;
    }

    setPending(true);

    const outcome = await requestHub((client) => client.SetOidcSettings({ settings: input.value }));

    setPending(false);

    if (outcome._tag === "Failure") {
      setResult({ ok: false, message: outcome.message });

      return;
    }

    const secret = form.elements.namedItem("clientSecret");

    if (secret instanceof HTMLInputElement) {
      secret.value = "";
    }

    if (turningOn) {
      await turnOn();
    } else {
      setResult({ ok: true, message: "Saved. The provider answered." });
    }
  };

  return (
    <>
      <form noValidate className="space-y-8" onSubmit={(event) => void submit(event)}>
        {turningOn && (
          <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm">
            {signInOn
              ? "Save your provider's details to turn on OpenID Connect."
              : "Save your provider's details, then sign in through it to check it works. That turns on OpenID Connect, and you stay an admin."}
          </p>
        )}
        <SettingsSection title="Provider">
          <div className="space-y-4 px-5 py-4">
            <p className="text-sm text-ink-muted">
              Create an OAuth2/OpenID application for FleetFrog at your provider, such as Authentik,
              as a confidential client, then copy its details here.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Name"
                name="providerName"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
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
                hint={
                  saved === null
                    ? undefined
                    : "Leave it empty to keep the saved one, unless the issuer URL or client ID changes."
                }
              />
            </div>
          </div>
        </SettingsSection>
        <ButtonSection settings={settings} name={name} />
        <SettingsSection title="Redirect">
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
            <TextField
              label="Dashboard URL"
              name="dashboardUrl"
              type="url"
              autoComplete="off"
              value={dashboardUrl}
              onChange={(event) => setDashboardUrl(event.currentTarget.value)}
              hint="Where people open FleetFrog."
              error={errorFor("dashboardUrl")}
            />
            <div className="space-y-1.5 text-sm">
              <p className="font-medium">Redirect URI</p>
              <p className="min-h-9 rounded-md border border-line bg-surface-raised px-2.5 py-2 font-mono text-[13px] break-all select-all">
                {callback ?? "Enter the dashboard URL first."}
              </p>
              <p className="text-ink-muted">Register this at the provider.</p>
            </div>
          </div>
        </SettingsSection>
        <SettingsSection title="Groups">
          <div className="grid gap-4 px-5 py-4 sm:grid-cols-2">
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
        </SettingsSection>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p role="status" className="text-sm empty:hidden">
            {result !== null && (
              <span className={result.ok ? "text-clean" : "text-danger"}>{result.message}</span>
            )}
          </p>
          <Button tone="primary" type="submit" disabled={pending} className="ms-auto">
            {pending ? "Checking…" : label}
          </Button>
        </div>
      </form>
      <form ref={activate} method="post" action="/auth/oidc/activate" hidden />
    </>
  );
}

export function OidcSettings() {
  const { enable } = useSearch({ from: "/_app/settings/authentication/oidc" });
  const settings = useHubStream({ key: "auth", open: (client) => client.WatchAuthSettings() });

  return (
    <SidebarPage
      title="OpenID Connect"
      parents={[{ label: "Authentication", to: "/settings/authentication" }]}
    >
      {settings._tag === "Loading" && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {settings._tag === "Failed" && (
        <p className="py-16 text-center text-sm text-danger">{settings.message}</p>
      )}
      {settings._tag === "Ready" && (
        <ProviderForm
          settings={settings.value}
          turningOn={enable === true && !settings.value.provider}
        />
      )}
    </SidebarPage>
  );
}
