import { useId } from "react";

import { Link } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon, Settings2Icon, UserRoundIcon } from "lucide-react";

import { signOut, useSession } from "@/rpc/session.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { MenuIcon, MenuItem, menuItemClass, Menu } from "@/ui/Menu.tsx";

import { changePreferences } from "../preferences/preferences.ts";
import { ThemePicker } from "../preferences/ThemePicker.tsx";

/**
 * A quick way to the theme, which Profile & Settings also offers. It doesn't say how saving went:
 * a save fails only when the hub is out of reach, which the header already shows.
 */
function QuickTheme() {
  const labelId = useId();

  return (
    <div className="px-3 py-2">
      <p id={labelId} className="mb-1.5 text-xs text-ink-muted">
        Theme
      </p>
      <ThemePicker
        labelledBy={labelId}
        onPick={(colorScheme) => void changePreferences({ colorScheme })}
      />
    </div>
  );
}

/**
 * The signed-in user's picture, opening the theme, Profile & Settings and sign-out. With sign-in
 * off, or when the hub never said who is signed in, it offers the theme and a link to the rest of
 * the preferences, under Appearance.
 */
export function UserMenu() {
  const session = useSession();

  // Waits to learn who is signed in, so the header doesn't swap one button for the other.
  if (session._tag === "Loading") {
    return null;
  }

  if (session._tag !== "Known" || session.session._tag !== "SignedIn") {
    return (
      <Menu
        label="Preferences"
        trigger={{
          content: <Settings2Icon aria-hidden="true" />,
          className:
            "-me-2 grid size-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-surface-raised hover:text-ink",
        }}
      >
        {(close) => (
          <>
            <QuickTheme />
            <div className="border-t border-line pt-1">
              <Link to="/account" onClick={close} className={menuItemClass}>
                <MenuIcon>
                  <Settings2Icon />
                </MenuIcon>
                Appearance
              </Link>
            </div>
          </>
        )}
      </Menu>
    );
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
              <p data-personal className="truncate text-xs text-ink-muted">
                {user.email}
              </p>
            </div>
          </div>
          <div className="border-t border-line py-1">
            <QuickTheme />
          </div>
          <div className="border-t border-line pt-1">
            <Link to="/account" onClick={close} className={menuItemClass}>
              <MenuIcon>
                <UserRoundIcon />
              </MenuIcon>
              Profile & Settings
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
