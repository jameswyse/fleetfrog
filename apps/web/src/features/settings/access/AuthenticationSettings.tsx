import { useState } from "react";

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
import { minimumPasswordLength } from "@fleetfrog/protocol/domain/user";

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

const modes: ReadonlyArray<{
  readonly mode: AuthMode;
  readonly title: string;
  readonly description: string;
}> = [
  {
    mode: "none",
    title: "Off",
    description:
      "Anyone who can reach the dashboard can use all of it. For a private network, or behind a proxy that signs people in, such as Pangolin.",
  },
  {
    mode: "local",
    title: "Email and password",
    description: "People sign in with the accounts under Users.",
  },
];

function ModeChoice({ settings }: { readonly settings: AuthSettingsView }) {
  const [changing, setChanging] = useState<AuthMode | null>(null);

  return (
    <SettingsSection title="How people sign in">
      <fieldset disabled={settings.overridden}>
        <legend className="sr-only">How people sign in</legend>
        {modes.map(({ mode, title, description }) => (
          <label
            key={mode}
            className="flex cursor-pointer items-start gap-3 border-line px-5 py-4 not-first-of-type:border-t hover:bg-surface-raised has-disabled:cursor-not-allowed has-disabled:opacity-60"
          >
            <input
              type="radio"
              name="mode"
              value={mode}
              checked={settings.mode === mode}
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
          <ModeChoice settings={settings.value} />
          <GravatarSection settings={settings.value} />
        </>
      )}
    </SidebarPage>
  );
}
