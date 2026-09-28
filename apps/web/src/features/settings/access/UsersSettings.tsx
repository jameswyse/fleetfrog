import { useState } from "react";

import { KeyRoundIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { useSession } from "@/rpc/session.ts";
import { useHubStream } from "@/rpc/useHubStream.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { Button } from "@/ui/Button.tsx";
import { Chip } from "@/ui/Chip.tsx";
import { Menu, MenuItem } from "@/ui/Menu.tsx";
import { plural } from "@/ui/plural.ts";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";

import { SettingsSection } from "../SettingsSection.tsx";
import {
  AddUserDialog,
  DeleteUserDialog,
  EditUserDialog,
  SetPasswordDialog,
} from "./UserDialogs.tsx";

import type { User } from "@fleetfrog/protocol/domain/user";

type Editing =
  | { readonly _tag: "Edit"; readonly user: User }
  | { readonly _tag: "Password"; readonly user: User }
  | { readonly _tag: "Delete"; readonly user: User };

function UserRow({
  user,
  isMe,
  onEdit,
}: {
  readonly user: User;
  readonly isMe: boolean;
  readonly onEdit: (editing: Editing) => void;
}) {
  return (
    <li className="flex items-center gap-4 px-5 py-3">
      <Avatar user={user} size={36} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{user.displayName}</span>
          {isMe && <Chip tone="neutral">You</Chip>}
          {user.role === "admin" && <Chip tone="neutral">Admin</Chip>}
        </p>
        <p className="truncate text-sm text-ink-muted">{user.email}</p>
      </div>
      <p className="hidden shrink-0 text-sm text-ink-muted sm:block">
        {user.lastSignedInAt === null ? (
          "Never signed in"
        ) : (
          <>
            Signed in <RelativeTime at={user.lastSignedInAt} />
          </>
        )}
      </p>
      <Menu label={`Actions for ${user.displayName}`}>
        {(close) => (
          <>
            <MenuItem
              icon={<PencilIcon />}
              onClick={() => {
                close();
                onEdit({ _tag: "Edit", user });
              }}
            >
              Edit…
            </MenuItem>
            <MenuItem
              icon={<KeyRoundIcon />}
              onClick={() => {
                close();
                onEdit({ _tag: "Password", user });
              }}
            >
              {user.hasPassword ? "Set a new password…" : "Set a password…"}
            </MenuItem>
            {!isMe && (
              <MenuItem
                icon={<Trash2Icon />}
                className="text-danger"
                onClick={() => {
                  close();
                  onEdit({ _tag: "Delete", user });
                }}
              >
                Delete…
              </MenuItem>
            )}
          </>
        )}
      </Menu>
    </li>
  );
}

/** Everyone who can sign in to the dashboard, for admins. */
export function UsersSettings() {
  const session = useSession();
  const users = useHubStream({ key: "users", open: (client) => client.WatchUsers() });
  const auth = useHubStream({ key: "auth", open: (client) => client.WatchAuthSettings() });
  // With an admin group, the provider decides the role of everyone who signs in through it.
  const adminGroup =
    auth._tag === "Ready" && auth.value.provider ? (auth.value.oidc?.adminGroup ?? null) : null;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);
  const known = session._tag === "Known" ? session.session : null;
  const myId = known?._tag === "SignedIn" ? known.user.id : null;

  return (
    <SidebarPage
      title="Users"
      parents={[{ label: "Authentication", to: "/settings/authentication" }]}
      action={
        <Button tone="primary" onClick={() => setAdding(true)}>
          <PlusIcon aria-hidden="true" />
          Add user
        </Button>
      }
    >
      {known?._tag === "Open" && (
        <p className="rounded-xl border border-line bg-surface px-5 py-4 text-sm text-ink-muted">
          Sign-in is off, so nobody uses these accounts until you turn it on under Authentication.
        </p>
      )}
      {users._tag === "Loading" && (
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      )}
      {users._tag === "Failed" && (
        <p className="py-16 text-center text-sm text-danger">{users.message}</p>
      )}
      {users._tag === "Ready" && users.value.length === 0 && (
        <p className="py-16 text-center text-sm text-ink-muted">
          No users yet. Turning on password sign-in creates your account.
        </p>
      )}
      {users._tag === "Ready" && users.value.length > 0 && (
        <SettingsSection title={plural(users.value.length, "user", "users")}>
          <ul className="divide-y divide-line">
            {users.value.map((user) => (
              <UserRow key={user.id} user={user} isMe={user.id === myId} onEdit={setEditing} />
            ))}
          </ul>
        </SettingsSection>
      )}
      {adding && (
        <AddUserDialog
          passwordsOn={known?._tag === "SignedIn" && known.methods.passwords}
          onClose={() => setAdding(false)}
        />
      )}
      {editing?._tag === "Edit" && (
        <EditUserDialog
          user={editing.user}
          isMe={editing.user.id === myId}
          roleFromGroup={adminGroup}
          onClose={() => setEditing(null)}
        />
      )}
      {editing?._tag === "Password" && (
        <SetPasswordDialog user={editing.user} onClose={() => setEditing(null)} />
      )}
      {editing?._tag === "Delete" && (
        <DeleteUserDialog user={editing.user} onClose={() => setEditing(null)} />
      )}
    </SidebarPage>
  );
}
