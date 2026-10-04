import { useState } from "react";

import { Schema } from "effect";
import { TriangleAlertIcon } from "lucide-react";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";
import {
  supportedT3CodeSchema,
  T3CodeSettings as SettingsSchema,
} from "@fleetfrog/protocol/domain/t3Code";

import { SettingsRow, SettingsSection, SideDetail, SidePanel } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";
import { ReadingSummary, SchemaText, unmatchedProjects } from "./T3CodeFacts.tsx";
import { describeIssue, t3CodeIssues } from "./t3CodeHealth.ts";

import type { Fleet } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeSettings as Settings } from "@fleetfrog/protocol/domain/t3Code";

const sameSettings = Schema.toEquivalence(SettingsSchema);

function SettingsSwitches({ saved }: { readonly saved: Settings }) {
  const { state, save } = useAutoSave();
  const [draft, setDraft] = useState<Settings | null>(null);

  if (draft !== null && sameSettings(draft, saved)) {
    setDraft(null);
  }

  const settings = draft ?? saved;

  const change = async (next: Partial<Settings>) => {
    const changed = { ...settings, ...next };

    setDraft(changed);

    const result = await save(() =>
      requestHub((client) => client.UpdateIntegrations({ integrations: { t3Code: changed } })),
    );

    if (result._tag === "Failure") {
      setDraft(null);
    }
  };

  return (
    <SettingsSection title="Settings" status={<SaveStatus state={state} />}>
      <SettingsRow
        title="Read T3 Code"
        description="Agents read T3 Code's projects and threads on each machine after every scan. They never change anything in T3 Code."
        htmlFor="t3code-enabled"
        control={
          <Switch
            id="t3code-enabled"
            aria-describedby="t3code-enabled-description"
            checked={settings.enabled}
            onChange={(enabled) => void change({ enabled })}
          />
        }
      />
      <SettingsRow
        title="Project names and icons"
        description="Show each repository under T3 Code's name and icon for it. Searching still finds the repository's own name."
        htmlFor="t3code-appearance"
        control={
          <Switch
            id="t3code-appearance"
            aria-describedby="t3code-appearance-description"
            checked={settings.projectAppearance}
            disabled={!settings.enabled}
            onChange={(projectAppearance) => void change({ projectAppearance })}
          />
        }
      />
      <SettingsRow
        title="Find projects outside project folders"
        description="Also show repositories that T3 Code has as projects, wherever they are on the machine."
        htmlFor="t3code-discovery"
        control={
          <Switch
            id="t3code-discovery"
            aria-describedby="t3code-discovery-description"
            checked={settings.discoverProjects}
            disabled={!settings.enabled}
            onChange={(discoverProjects) => void change({ discoverProjects })}
          />
        }
      />
    </SettingsSection>
  );
}

function MachinesSection({ fleet }: { readonly fleet: Fleet }) {
  return (
    <SettingsSection title="Machines">
      {fleet.machines.map((machine) => {
        const offline = machine.connection._tag === "Offline";

        return (
          <SettingsRow
            key={machine.id}
            title={
              <span className="flex items-center gap-2">
                <MachineKindIcon kind={machineKind(machine)} className="text-ink-muted" />
                {machineLabel(machine)}
                {offline && <span className="font-normal text-ink-muted">(offline)</span>}
              </span>
            }
            description={<ReadingSummary fleet={fleet} machine={machine} />}
            control={
              machine.t3Code === null ? undefined : (
                <dl className="text-end text-sm">
                  <dt className="sr-only">Version</dt>
                  <dd className="font-mono text-[13px]">
                    {machine.t3Code.server === null ? (
                      <span className="font-sans text-ink-muted">Not running</span>
                    ) : (
                      (machine.t3Code.server.version ?? "Version unknown")
                    )}
                  </dd>
                  <dt className="sr-only">Schema</dt>
                  <dd>
                    <SchemaText machine={machine} />
                  </dd>
                  {machine.lastStatusAt !== null && (
                    <>
                      <dt className="sr-only">Last checked</dt>
                      <dd className="text-ink-muted">
                        Checked <RelativeTime at={machine.lastStatusAt} />
                      </dd>
                    </>
                  )}
                </dl>
              )
            }
          />
        );
      })}
    </SettingsSection>
  );
}

function UnmatchedSection({ fleet }: { readonly fleet: Fleet }) {
  const unmatched = fleet.machines.flatMap((machine) =>
    unmatchedProjects(fleet, machine).map((project) => ({ machine, project })),
  );

  if (unmatched.length === 0) {
    return null;
  }

  return (
    <SettingsSection title="Projects without a repository">
      {unmatched.map(({ machine, project }) => (
        <SettingsRow
          key={`${machine.id}:${project.id}`}
          title={
            <span className="flex items-center gap-2">
              {project.icon !== null && <ProjectIcon icon={project.icon} />}
              {project.title}
            </span>
          }
          description={
            <>
              <span className="font-mono text-xs break-all">{project.path}</span> on{" "}
              {machineLabel(machine)}
            </>
          }
        />
      ))}
    </SettingsSection>
  );
}

function versionsInUse(fleet: Fleet) {
  const machines = new Map<string, Array<string>>();

  for (const machine of fleet.machines) {
    const version = machine.t3Code?.server?.version;

    if (version !== undefined && version !== null) {
      machines.set(version, [...(machines.get(version) ?? []), machineLabel(machine)]);
    }
  }

  return [...machines].toSorted(([left], [right]) =>
    right.localeCompare(left, undefined, { numeric: true }),
  );
}

function AboutPanel({ fleet }: { readonly fleet: Fleet }) {
  const versions = versionsInUse(fleet);

  return (
    <SidePanel title="About">
      <SideDetail term="Built for">
        <span title={supportedT3CodeSchema.name}>
          T3 Code's schema at migration {supportedT3CodeSchema.migration}
        </span>
      </SideDetail>
      {versions.length > 0 && (
        <SideDetail term={versions.length === 1 ? "Version running" : "Versions running"}>
          <ul className="space-y-1">
            {versions.map(([version, machines]) => (
              <li key={version}>
                <span className="font-mono text-[13px] break-all">{version}</span>
                <span className="block text-xs text-ink-muted">{machines.join(", ")}</span>
              </li>
            ))}
          </ul>
        </SideDetail>
      )}
      <SideDetail term="Access">Read-only</SideDetail>
    </SidePanel>
  );
}

export function T3CodeSettings() {
  const hub = useHub();
  const fleet = knownFleet(hub);
  const parents = [{ label: "Integrations", to: "/settings/integrations" }] as const;

  if (fleet === null) {
    return (
      <SidebarPage title="T3 Code" parents={parents}>
        <p className="py-16 text-center text-sm text-ink-muted">Waiting for the hub…</p>
      </SidebarPage>
    );
  }

  const settings = fleet.integrations.t3Code;
  const issues = t3CodeIssues(fleet);

  return (
    <SidebarPage title="T3 Code" parents={parents} aside={<AboutPanel fleet={fleet} />}>
      {issues.length > 0 && (
        <div className="space-y-2">
          {issues.map((issue) => (
            <p
              key={`${issue.machine.id}:${issue._tag}`}
              className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm text-danger"
            >
              <TriangleAlertIcon className="mt-0.5" />
              <span className="min-w-0 break-words">{describeIssue(issue)}</span>
            </p>
          ))}
        </div>
      )}
      <SettingsSwitches saved={settings} />
      {settings.enabled && (
        <>
          <MachinesSection fleet={fleet} />
          <UnmatchedSection fleet={fleet} />
        </>
      )}
    </SidebarPage>
  );
}
