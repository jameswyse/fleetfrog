import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon, UserRoundIcon } from "lucide-react";

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
      label={`Account menu for ${user.displayName}`}
      trigger={{
        content: (
          <>
            <Avatar user={user} size={28} />
            <span className="hidden max-w-40 truncate sm:inline">{user.displayName}</span>
            <ChevronDownIcon aria-hidden="true" className="text-ink-muted" />
          </>
        ),
        className:
          "-me-2 flex min-h-10 shrink-0 items-center gap-2 rounded-full py-1 ps-1 pe-2.5 text-sm hover:bg-surface-raised",
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
