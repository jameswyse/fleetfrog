import { Link } from "@tanstack/react-router";
import { LogOutIcon, UserRoundIcon } from "lucide-react";

import { signOut, useSession } from "@/rpc/session.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { MenuIcon, MenuItem, menuItemClass, Menu } from "@/ui/Menu.tsx";

/** The signed-in user's picture, opening their profile and sign-out. Absent with sign-in off. */
export function UserMenu() {
  const session = useSession();

  if (session._tag !== "Known" || session.session._tag !== "SignedIn") {
    return null;
  }

  const { user } = session.session;

  return (
    <Menu
      label={`Account: ${user.displayName}`}
      trigger={{
        content: <Avatar user={user} size={32} />,
        className:
          "-me-1 grid size-10 shrink-0 place-items-center rounded-full hover:bg-surface-raised",
      }}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-3 px-3 pt-2 pb-3">
            <Avatar user={user} size={40} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.displayName}</p>
              <p className="truncate text-xs text-ink-muted">{user.email}</p>
            </div>
          </div>
          <div className="border-t border-line pt-1">
            <Link to="/account" onClick={close} className={menuItemClass}>
              <MenuIcon>
                <UserRoundIcon />
              </MenuIcon>
              Profile
            </Link>
            <MenuItem
              icon={<LogOutIcon />}
              onClick={() => {
                close();
                void signOut();
              }}
            >
              Sign out
            </MenuItem>
          </div>
        </>
      )}
    </Menu>
  );
}
