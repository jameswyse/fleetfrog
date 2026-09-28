import { useId, useRef, useState } from "react";

import { Navigate } from "@tanstack/react-router";

import { requestHub } from "@/rpc/hubConnection.ts";
import { replaceUser, useSession } from "@/rpc/session.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { formText } from "@/ui/formText.ts";
import { minimumPasswordLength } from "@fleetfrog/protocol/domain/user";

import { SettingsRow, SettingsSection } from "../settings/SettingsSection.tsx";
import { resizeAvatar } from "./resizeAvatar.ts";

import type { SignInMethod } from "@fleetfrog/protocol/dashboard/auth";
import type { User } from "@fleetfrog/protocol/domain/user";

const inputClass =
  "min-h-9 w-64 max-w-full rounded-md border border-line bg-canvas px-2.5 text-sm aria-invalid:border-danger";

/** A stable region under a form, announcing how its last submission went. */
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

function PictureRow({ user, provider }: { readonly user: User; readonly provider: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const fromProvider = user.avatar._tag === "Provider";

  const save = async (avatar: Parameters<typeof resizeAvatar>[0] | null) => {
    setPending(true);
    setResult(null);

    const resized = avatar === null ? null : await resizeAvatar(avatar);

    if (avatar !== null && resized === null) {
      setPending(false);
      setResult({ ok: false, message: "That file isn't an image this browser can read." });

      return;
    }

    const outcome = await requestHub((client) => client.SetAvatar({ avatar: resized }));

    setPending(false);

    if (outcome._tag === "Success") {
      replaceUser(outcome.value);
      setResult({ ok: true, message: avatar === null ? "Picture removed." : "Picture updated." });
    } else {
      setResult({ ok: false, message: outcome.message });
    }
  };

  return (
    <SettingsRow
      title="Picture"
      description={
        fromProvider
          ? `Your picture comes from ${provider}. Change it there.`
          : "Shown beside your name. Without one, FleetFrog uses your Gravatar or your initials."
      }
      control={
        <div className="flex items-center gap-3">
          <Avatar user={user} size={48} />
          {!fromProvider && (
            <>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                tabIndex={-1}
                aria-hidden="true"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];

                  event.currentTarget.value = "";

                  if (file !== undefined) {
                    void save(file);
                  }
                }}
              />
              <Button disabled={pending} onClick={() => input.current?.click()}>
                {user.avatar._tag === "Uploaded" ? "Change…" : "Upload…"}
              </Button>
              {user.avatar._tag === "Uploaded" && (
                <Button tone="quiet" disabled={pending} onClick={() => void save(null)}>
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      }
    >
      <Result result={result} />
    </SettingsRow>
  );
}

function NameRow({ user, provider }: { readonly user: User; readonly provider: string }) {
  const nameId = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (user.displayNameFromProvider) {
    return (
      <SettingsRow
        title="Name"
        description={`Your name comes from ${provider}. Change it there.`}
        control={<p className="text-sm">{user.displayName}</p>}
      />
    );
  }

  return (
    <SettingsRow
      title="Name"
      description="How FleetFrog shows you to others."
      htmlFor={nameId}
      control={
        <form
          className="flex items-center gap-3"
          onSubmit={async (event) => {
            event.preventDefault();

            const displayName = formText(new FormData(event.currentTarget), "name").trim();

            if (displayName === "") {
              setResult({ ok: false, message: "Enter a name." });

              return;
            }

            setPending(true);

            const outcome = await requestHub((client) => client.UpdateProfile({ displayName }));

            setPending(false);

            if (outcome._tag === "Success") {
              replaceUser(outcome.value);
              setResult({ ok: true, message: "Name saved." });
            } else {
              setResult({ ok: false, message: outcome.message });
            }
          }}
        >
          <input
            key={user.displayName}
            id={nameId}
            name="name"
            defaultValue={user.displayName}
            autoComplete="name"
            maxLength={80}
            aria-describedby={`${nameId}-description ${nameId}-result`}
            className={inputClass}
          />
          <Button type="submit" disabled={pending}>
            Save
          </Button>
        </form>
      }
    >
      {result !== null && <Result id={`${nameId}-result`} result={result} />}
    </SettingsRow>
  );
}

function PasswordSection({ email }: { readonly email: string }) {
  const formId = useId();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [invalid, setInvalid] = useState<"current" | "new" | "confirm" | null>(null);
  const field = (name: "current" | "new" | "confirm") => `${formId}-${name}`;

  return (
    <SettingsSection title="Password">
      <form
        noValidate
        className="space-y-4 px-5 py-4"
        onSubmit={async (event) => {
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
        }}
      >
        {/* Tells password managers which account the new password is for. */}
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

function providerName(method: SignInMethod): string {
  return method._tag === "Provider" ? method.name : "your sign-in provider";
}

/** The signed-in user's own profile and password. */
export function AccountPage() {
  const session = useSession();

  if (session._tag !== "Known" || session.session._tag !== "SignedIn") {
    return <Navigate to="/" replace />;
  }

  const { user, method } = session.session;
  const provider = providerName(method);

  return (
    <>
      <div className="flex min-h-14 items-center border-b border-line px-4 py-2 sm:px-8">
        <h1 className="text-base font-semibold">Profile</h1>
      </div>
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8 sm:px-8">
        <SettingsSection title="You">
          <PictureRow user={user} provider={provider} />
          <NameRow user={user} provider={provider} />
          <SettingsRow
            title="Email"
            description={
              user.linkedToProvider
                ? `Set by ${provider}.`
                : "You sign in with this. An admin can change it."
            }
            control={<p className="text-sm break-all">{user.email}</p>}
          />
          <SettingsRow
            title="Role"
            description={
              user.role === "admin"
                ? "You can use everything, including Cleanup and Settings."
                : "You can see everything and fetch, pull, clone, switch and stash. Cleanup and Settings are for admins."
            }
            control={<p className="text-sm">{user.role === "admin" ? "Admin" : "User"}</p>}
          />
        </SettingsSection>
        {method._tag === "Password" && user.hasPassword && <PasswordSection email={user.email} />}
      </div>
    </>
  );
}
