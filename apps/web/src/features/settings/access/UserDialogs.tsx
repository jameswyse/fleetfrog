import { useState } from "react";

import { Option, Schema } from "effect";
import { ChevronDownIcon } from "lucide-react";

import { requestHub } from "@/rpc/hubConnection.ts";
import { Button } from "@/ui/Button.tsx";
import { Dialog } from "@/ui/Dialog.tsx";
import { formText } from "@/ui/formText.ts";
import { minimumPasswordLength, Role } from "@fleetfrog/protocol/domain/user";

import { TextField } from "./TextField.tsx";
import { checkFields, decodeEmail, messageFor } from "./userForm.ts";

import type { User } from "@fleetfrog/protocol/domain/user";

import type { FieldError } from "./userForm.ts";

const decodeRole = Schema.decodeUnknownOption(Role);

function RoleField({
  defaultValue,
  disabledReason,
}: {
  readonly defaultValue: User["role"];
  /** Why the role can't change, such as for the admin's own account. */
  readonly disabledReason: string | null;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor="user-role" className="block text-sm font-medium">
        Role
      </label>
      <span className="relative block">
        <select
          id="user-role"
          name="role"
          defaultValue={defaultValue}
          disabled={disabledReason !== null}
          aria-describedby="user-role-note"
          className="min-h-9 w-full appearance-none rounded-md border border-line bg-canvas ps-2.5 pe-8 text-sm disabled:opacity-60"
        >
          <option value="user">User</option>
          <option value="admin">Admin</option>
        </select>
        <ChevronDownIcon
          aria-hidden="true"
          className="pointer-events-none absolute end-2.5 top-1/2 -translate-y-1/2 text-ink-muted"
        />
      </span>
      <p id="user-role-note" className="text-sm text-ink-muted">
        {disabledReason ?? "Users can't use Cleanup, cleanup actions or Settings."}
      </p>
    </div>
  );
}

function Actions({
  pending,
  label,
  failure,
  onClose,
}: {
  readonly pending: boolean;
  readonly label: string;
  readonly failure: string | null;
  readonly onClose: () => void;
}) {
  return (
    <>
      <p role="status" className="text-sm text-danger empty:hidden">
        {failure}
      </p>
      <div className="flex justify-end gap-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button tone="primary" type="submit" disabled={pending}>
          {label}
        </Button>
      </div>
    </>
  );
}

export function AddUserDialog({
  passwordsOn,
  onClose,
}: {
  /** Whether people sign in with passwords, which makes one required. */
  readonly passwordsOn: boolean;
  readonly onClose: () => void;
}) {
  const [errors, setErrors] = useState<ReadonlyArray<FieldError>>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title="Add a user" onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const found = checkFields(form, ["displayName", "email", "password"], {
            passwordOptional: !passwordsOn,
          });
          const values = new FormData(form);
          const email = decodeEmail(formText(values, "email"));
          const role = decodeRole(formText(values, "role"));

          setErrors(found);

          if (found.length > 0 || Option.isNone(email) || Option.isNone(role)) {
            return;
          }

          const password = formText(values, "password");

          setPending(true);
          setFailure(null);

          const outcome = await requestHub((client) =>
            client.CreateUser({
              displayName: formText(values, "displayName").trim(),
              email: email.value,
              role: role.value,
              password: password === "" ? null : password,
            }),
          );

          setPending(false);

          if (outcome._tag === "Failure") {
            setFailure(outcome.message);
          } else {
            onClose();
          }
        }}
      >
        <TextField
          label="Name"
          name="displayName"
          autoComplete="off"
          error={messageFor(errors, "displayName")}
        />
        <TextField
          data-personal
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          error={messageFor(errors, "email")}
        />
        <RoleField defaultValue="user" disabledReason={null} />
        <TextField
          label={passwordsOn ? "Password" : "Password (optional)"}
          name="password"
          type="password"
          autoComplete="new-password"
          hint={
            passwordsOn
              ? `At least ${minimumPasswordLength} characters. Share it with them, and they can change it from their profile.`
              : "Only needed for password sign-in. Leave it empty for someone who signs in through the provider."
          }
          error={messageFor(errors, "password")}
        />
        <Actions
          pending={pending}
          label={pending ? "Adding…" : "Add user"}
          failure={failure}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}

function roleLockReason({
  isMe,
  roleFromGroup,
}: {
  readonly isMe: boolean;
  readonly roleFromGroup: string | null;
}): string | null {
  if (roleFromGroup !== null) {
    return `Members of the ${roleFromGroup} group at the provider are admins, checked at each sign-in.`;
  }

  return isMe ? "You can't change your own role." : null;
}

export function EditUserDialog({
  user,
  isMe,
  roleFromGroup,
  onClose,
}: {
  readonly user: User;
  readonly isMe: boolean;
  /** The provider group that makes people admins, when the provider decides roles. */
  readonly roleFromGroup: string | null;
  readonly onClose: () => void;
}) {
  const roleLocked = isMe || roleFromGroup !== null;
  const [errors, setErrors] = useState<ReadonlyArray<FieldError>>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title={`Edit ${user.displayName}`} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const found = checkFields(form, ["displayName", "email"]);
          const values = new FormData(form);
          const email = decodeEmail(formText(values, "email"));
          // A disabled select isn't submitted, so the role stays as it was.
          const role = roleLocked ? Option.some(user.role) : decodeRole(formText(values, "role"));

          setErrors(found);

          if (found.length > 0 || Option.isNone(email) || Option.isNone(role)) {
            return;
          }

          setPending(true);
          setFailure(null);

          const outcome = await requestHub((client) =>
            client.UpdateUser({
              userId: user.id,
              displayName: user.displayNameFromProvider
                ? user.displayName
                : formText(values, "displayName").trim(),
              email: email.value,
              role: role.value,
            }),
          );

          setPending(false);

          if (outcome._tag === "Failure") {
            setFailure(outcome.message);
          } else {
            onClose();
          }
        }}
      >
        <TextField
          label="Name"
          name="displayName"
          autoComplete="off"
          defaultValue={user.displayName}
          readOnly={user.displayNameFromProvider}
          hint={user.displayNameFromProvider ? "Their sign-in provider sets this." : undefined}
          error={messageFor(errors, "displayName")}
        />
        <TextField
          data-personal
          label="Email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          defaultValue={user.email}
          error={messageFor(errors, "email")}
        />
        <RoleField
          defaultValue={user.role}
          disabledReason={roleLockReason({ isMe, roleFromGroup })}
        />
        {!roleLocked && (
          <p className="text-sm text-ink-muted">
            Changing their role signs them out, so they sign in again with it.
          </p>
        )}
        <Actions
          pending={pending}
          label={pending ? "Saving…" : "Save"}
          failure={failure}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}

export function SetPasswordDialog({
  user,
  onClose,
}: {
  readonly user: User;
  readonly onClose: () => void;
}) {
  const [errors, setErrors] = useState<ReadonlyArray<FieldError>>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title={`Set ${user.displayName}'s password`} onClose={onClose}>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();

          const form = event.currentTarget;
          const found = checkFields(form, ["password"]);

          setErrors(found);

          if (found.length > 0) {
            return;
          }

          setPending(true);
          setFailure(null);

          const password = formText(new FormData(form), "password");
          const outcome = await requestHub((client) =>
            client.SetUserPassword({ userId: user.id, password }),
          );

          setPending(false);

          if (outcome._tag === "Failure") {
            setFailure(outcome.message);
          } else {
            onClose();
          }
        }}
      >
        <p className="text-sm">
          They're signed out everywhere and sign in again with the new password. Share it with them,
          and they can change it from their profile.
        </p>
        <TextField
          label="New password"
          name="password"
          type="password"
          autoComplete="new-password"
          hint={`At least ${minimumPasswordLength} characters.`}
          error={messageFor(errors, "password")}
        />
        <Actions
          pending={pending}
          label={pending ? "Setting…" : "Set password"}
          failure={failure}
          onClose={onClose}
        />
      </form>
    </Dialog>
  );
}

export function DeleteUserDialog({
  user,
  onClose,
}: {
  readonly user: User;
  readonly onClose: () => void;
}) {
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog title={`Delete ${user.displayName}?`} onClose={onClose}>
      <div className="space-y-4 text-sm">
        <p>
          They're signed out and can't sign in again. What they did stays in Activity.
          {user.linkedToProvider &&
            " If they can still sign in through the provider, that creates a new account for them."}
          {user.linkedToTailscale &&
            " If they can still sign in through Tailscale, that creates a new account for them."}
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

              const outcome = await requestHub((client) => client.DeleteUser({ userId: user.id }));

              setPending(false);

              if (outcome._tag === "Failure") {
                setFailure(outcome.message);
              } else {
                onClose();
              }
            }}
          >
            {pending ? "Deleting…" : "Delete user"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
