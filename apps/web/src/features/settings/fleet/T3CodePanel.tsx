import { RelativeTime } from "@/ui/RelativeTime.tsx";

import { ReadingSummary, SchemaText } from "../integrations/T3CodeFacts.tsx";
import { SideDetail, SidePanel } from "../SettingsSection.tsx";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProvider } from "@fleetfrog/protocol/domain/t3Code";

/** What stands in the way of a coding agent, or null when it's ready. */
function providerNote(provider: T3CodeProvider): string | null {
  if (!provider.ready) {
    return "not ready";
  }

  return provider.signedIn ? null : "not signed in";
}

/** T3 Code on this machine, for the side column, while the integration is on. */
export function T3CodePanel({
  fleet,
  machine,
}: {
  readonly fleet: Fleet;
  readonly machine: Machine;
}) {
  const status = machine.t3Code;

  if (!fleet.integrations.t3Code.enabled || status === null) {
    return null;
  }

  const { reading, server, providers } = status;
  const installed = reading._tag !== "NotFound";

  return (
    <SidePanel title="T3 Code">
      {installed ? (
        <>
          <SideDetail term="Version">
            {server === null ? (
              "Not running"
            ) : (
              <span className="font-mono text-[13px] break-all">{server.version ?? "Unknown"}</span>
            )}
          </SideDetail>
          {server !== null && (
            <SideDetail term="Server">
              Running since <RelativeTime at={server.startedAt} />, on port {server.port}
            </SideDetail>
          )}
          <SideDetail term="Database">
            <SchemaText machine={machine} />
          </SideDetail>
          <SideDetail term="Projects and threads">
            <ReadingSummary fleet={fleet} machine={machine} />
          </SideDetail>
          {providers.length > 0 && (
            <SideDetail term="Coding agents">
              <ul className="space-y-0.5">
                {providers.map((provider) => {
                  const note = providerNote(provider);

                  return (
                    <li key={provider.name}>
                      {provider.name}
                      {provider.version !== null && (
                        <span className="font-mono text-[13px] text-ink-muted">
                          {" "}
                          {provider.version}
                        </span>
                      )}
                      {provider.latestVersion !== null && (
                        <span className="text-ink-muted">
                          {" "}
                          · {provider.latestVersion} available
                        </span>
                      )}
                      {note !== null && <span className="text-danger"> · {note}</span>}
                    </li>
                  );
                })}
              </ul>
            </SideDetail>
          )}
        </>
      ) : (
        <SideDetail term="Version">Not installed</SideDetail>
      )}
    </SidePanel>
  );
}
