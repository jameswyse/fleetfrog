import { useId, useRef, useState } from "react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { replaceUser, useSession } from "@/rpc/session.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { formText } from "@/ui/formText.ts";
import { minimumPasswordLength } from "@fleetfrog/protocol/domain/user";

import { PreferenceSettings } from "../preferences/PreferenceSettings.tsx";
import { SettingsRow, SettingsSection } from "../settings/SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../settings/useAutoSave.tsx";
import { resizeAvatar } from "./resizeAvatar.ts";

import type { FormEvent } from "react";

import type { User } from "@fleetfrog/protocol/domain/user";

const inputClass =
  "min-h-9 w-64 max-w-full rounded-md border border-line bg-canvas px-2.5 text-sm aria-invalid:border-danger";

function Result({
  id,
  result,
}: {
  readonly id?: string;
  readonly result: { readonly ok: boolean; readonly message: string } | null;
}) {
  return (
    <p id={id} role="status" className="text-sm empty:hidden">
      {result !== null && (
        <span className={result.ok ? "text-clean" : "text-danger"}>{result.message}</span>
      )}
    </p>
  );
}

function ProfileSection({ user }: { readonly user: User }) {
  const nameId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const { state, save } = useAutoSave();
  const saving = state._tag === "Saving";

  const savePicture = async (file: File | null) => {
    const result = await save(async () => {
      const resized = file === null ? null : await resizeAvatar(file);

      if (file !== null && resized === null) {
        return { _tag: "Failure", message: "That file isn't an image this browser can read." };
      }

      return requestHub((client) => client.SetAvatar({ avatar: resized }));
    });

    if (result._tag === "Success") {
      replaceUser(result.value);
    }
  };

  const saveName = async (input: HTMLInputElement) => {
    const displayName = input.value.trim();

    if (displayName === "" || displayName === user.displayName) {
      input.value = user.displayName;

      return;
    }

    const result = await save(() => requestHub((client) => client.UpdateProfile({ displayName })));

    if (result._tag === "Success") {
      replaceUser(result.value);
    }
  };

  return (
    <SettingsSection title="You" status={<SaveStatus state={state} />}>
      <SettingsRow
        title="Picture"
        control={
          <div className="flex items-center gap-3">
            <Avatar user={user} size={48} />
            {user.avatar._tag !== "Provider" && (
              <>
                <input
                  ref={picker}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  tabIndex={-1}
                  aria-hidden="true"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];

                    event.currentTarget.value = "";

                    if (file !== undefined) {
                      void savePicture(file);
                    }
                  }}
                />
                <Button disabled={saving} onClick={() => picker.current?.click()}>
                  {user.avatar._tag === "Uploaded" ? "Change…" : "Upload…"}
                </Button>
                {user.avatar._tag === "Uploaded" && (
                  <Button tone="quiet" disabled={saving} onClick={() => void savePicture(null)}>
                    Remove
                  </Button>
                )}
              </>
            )}
          </div>
        }
      />
      <SettingsRow
        title="Name"
        {...(!user.displayNameFromProvider && { htmlFor: nameId })}
        control={
          user.displayNameFromProvider ? (
            <p className="text-sm">{user.displayName}</p>
          ) : (
            <input
              key={user.displayName}
              id={nameId}
              defaultValue={user.displayName}
              autoComplete="name"
              maxLength={80}
              onBlur={(event) => void saveName(event.currentTarget)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              className={inputClass}
            />
          )
        }
      />
      <SettingsRow
        title="Email"
        control={
          <p data-personal className="text-sm break-all">
            {user.email}
          </p>
        }
      />
      <SettingsRow
        title="Role"
        control={<p className="text-sm">{user.role === "admin" ? "Admin" : "User"}</p>}
      />
    </SettingsSection>
  );
}

function PasswordSection({ email }: { readonly email: string }) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [invalid, setInvalid] = useState<"current" | "new" | "confirm" | null>(null);
  const field = (name: "current" | "new" | "confirm") => `${formId}-${name}`;

  const submitPasswordChange = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const form = event.currentTarget;
    const values = new FormData(form);
    const currentPassword = formText(values, "current");
    const newPassword = formText(values, "new");

    const fail = (name: "current" | "new" | "confirm", message: string) => {
      setInvalid(name);
      setResult({ ok: false, message });
      document.getElementById(field(name))?.focus();
    };

    if (newPassword.length < minimumPasswordLength) {
      return fail("new", `Use at least ${minimumPasswordLength} characters.`);
    }

    if (newPassword !== values.get("confirm")) {
      return fail("confirm", "The new passwords don't match.");
    }

    setPending(true);
    setInvalid(null);

    const outcome = await requestHub((client) =>
      client.ChangePassword({ currentPassword, newPassword }),
    );

    setPending(false);

    if (outcome._tag === "Failure") {
      return fail("current", outcome.message);
    }

    form.reset();

    return setResult({
      ok: true,
      message: "Password changed. Anywhere else you were signed in has been signed out.",
    });
  };

  return (
    <SettingsSection title="Password">
      <form
        noValidate
        className="space-y-4 px-5 py-4"
        onSubmit={(event) => void submitPasswordChange(event)}
      >
        <input hidden readOnly name="username" autoComplete="username" value={email} />
        {(
          [
            ["current", "Current password", "current-password"],
            ["new", "New password", "new-password"],
            ["confirm", "Confirm new password", "new-password"],
          ] as const
        ).map(([name, label, autoComplete]) => (
          <div key={name} className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
            <label htmlFor={field(name)} className="text-sm font-medium">
              {label}
            </label>
            <input
              id={field(name)}
              name={name}
              type="password"
              autoComplete={autoComplete}
              aria-invalid={invalid === name}
              aria-describedby={invalid === name ? `${formId}-result` : undefined}
              className={inputClass}
            />
          </div>
        ))}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Result id={`${formId}-result`} result={result} />
          <Button tone="primary" type="submit" disabled={pending} className="ms-auto">
            Change password
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

export function AccountPage() {
  const session = useSession();

  const signedIn =
    session._tag === "Known" && session.session._tag === "SignedIn" ? session.session : null;

  return (
    <>
      <div className="flex min-h-14 items-center border-b border-line px-4 py-2 sm:px-8">
        <h1 className="text-base font-semibold">
          {signedIn === null ? "Appearance" : "Profile & Settings"}
        </h1>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-8">
        {signedIn !== null && (
          <>
            <ProfileSection user={signedIn.user} />
            {signedIn.methods.passwords && signedIn.user.hasPassword && (
              <PasswordSection email={signedIn.user.email} />
            )}
          </>
        )}
        <PreferenceSettings
          title={
            session._tag === "Known" && session.session._tag === "Open"
              ? "For everyone, while sign-in is off"
              : "Appearance"
          }
        />
      </div>
    </>
  );
}
