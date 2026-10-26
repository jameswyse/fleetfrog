import { useId } from "react";

import { Link } from "@tanstack/react-router";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  LogOutIcon,
  Settings2Icon,
  UserRoundIcon,
} from "lucide-react";

import { knownFleet, useHub } from "@/rpc/hubConnection.ts";
import { signOut, useSession } from "@/rpc/session.ts";
import { Avatar } from "@/ui/Avatar.tsx";
import { MenuIcon, MenuItem, menuItemClass, Menu } from "@/ui/Menu.tsx";

import { changePreferences } from "../preferences/preferences.ts";
import { ThemePicker } from "../preferences/ThemePicker.tsx";

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

function releaseUrl(version: string): string {
  return `https://github.com/jameswyse/fleetfrog/releases/tag/v${version}`;
}

function HubVersion({ close }: { readonly close: () => void }) {
  const fleet = knownFleet(useHub());

  if (fleet === null) {
    return null;
  }

  return (
    <div className="mt-1 border-t border-line pt-1">
      <a
        href={releaseUrl(fleet.hubVersion)}
        target="_blank"
        rel="noreferrer"
        onClick={close}
        className="flex items-center justify-between gap-2.5 rounded px-3 py-1.5 text-xs text-ink-muted hover:bg-surface-raised hover:text-ink"
      >
        FleetFrog {fleet.hubVersion}
        <ArrowUpRightIcon aria-hidden="true" className="size-3.5" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </div>
  );
}

export function UserMenu() {
  const session = useSession();

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
            <HubVersion close={close} />
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
          <HubVersion close={close} />
        </>
      )}
    </Menu>
  );
}
