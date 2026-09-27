import { useState } from "react";

import { Schema } from "effect";
import { TriangleAlertIcon } from "lucide-react";

import { knownFleet, requestHub, useHub } from "@/rpc/hubConnection.ts";
import { MachineKindIcon } from "@/ui/MachineKindIcon.tsx";
import { plural } from "@/ui/plural.ts";
import { ProjectIcon } from "@/ui/ProjectIcon.tsx";
import { RelativeTime } from "@/ui/RelativeTime.tsx";
import { SidebarPage } from "@/ui/SidebarLayout.tsx";
import { Switch } from "@/ui/Switch.tsx";
import { machineKind, machineLabel } from "@fleetfrog/protocol/domain/fleet";
import {
  schemaDrift,
  supportedT3CodeSchema,
  T3CodeSettings as SettingsSchema,
} from "@fleetfrog/protocol/domain/t3Code";

import { SettingsRow, SettingsSection, SideDetail, SidePanel } from "../SettingsSection.tsx";
import { SaveStatus, useAutoSave } from "../useAutoSave.tsx";
import { describeIssue, t3CodeIssues } from "./t3CodeHealth.ts";

import type { Fleet, Machine } from "@fleetfrog/protocol/domain/fleet";
import type { T3CodeProject, T3CodeSettings as Settings } from "@fleetfrog/protocol/domain/t3Code";

const sameSettings = Schema.toEquivalence(SettingsSchema);

/** Paths of every checkout the machine reported, archived or not. */
function checkoutPaths(fleet: Fleet, machine: Machine): ReadonlySet<string> {
  return new Set(
    [...fleet.repositories, ...fleet.archive].flatMap(({ checkouts }) =>
      checkouts.flatMap(({ machineId, checkout }) =>
        machineId === machine.id ? [checkout.path] : [],
      ),
    ),
  );
}

/** T3 Code's projects on the machine whose folder isn't a checkout FleetFrog knows. */
function unmatchedProjects(fleet: Fleet, machine: Machine): ReadonlyArray<T3CodeProject> {
  const reading = machine.t3Code?.reading;

  if (reading?._tag !== "Read") {
    return [];
  }

  const paths = checkoutPaths(fleet, machine);

  return reading.projects.filter(({ path }) => !paths.has(path));
}

function SettingsSwitches({ saved }: { readonly saved: Settings }) {
  const { state, save } = useAutoSave();
  // Switches move as they're flipped, before the hub sends the saved settings back, and each change
  // builds on the last, so flipping two quickly saves both.
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

    // The switches go back to what the hub has, and the status beside them says why.
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

/** What the machine's agent last found, in a few words. */
function ReadingSummary({ fleet, machine }: { readonly fleet: Fleet; readonly machine: Machine }) {
  const status = machine.t3Code;

  if (status === null) {
    return (
      <span className="text-ink-muted">
        {machine.connection._tag === "Offline"
          ? "Not read yet. The machine is offline."
          : "Not read yet. If this lasts past the next scan, update the agent."}
      </span>
    );
  }

  const { reading } = status;

  const database = <span className="font-mono text-xs break-all">{status.database}</span>;

  if (reading._tag === "NotFound") {
    return <span className="text-ink-muted">T3 Code isn't installed. There's no {database}.</span>;
  }

  if (reading._tag === "Unreadable") {
    return (
      <span className="text-danger">
        {reading.message} It's at {database}.
      </span>
    );
  }

  const unmatched = unmatchedProjects(fleet, machine).length;
  const working = reading.threads.filter(({ state }) => state !== "Idle").length;

  return (
    <span>
      {plural(reading.projects.length, "project")}
      {unmatched > 0 && `, ${unmatched} without a repository here`}
      {" · "}
      {plural(reading.threadCount, "thread")}
      {working > 0 && `, ${working} in progress`}
    </span>
  );
}

function SchemaText({ machine }: { readonly machine: Machine }) {
  const reading = machine.t3Code?.reading;
  const schema = reading === undefined || reading._tag === "NotFound" ? null : reading.schema;

  if (schema === null) {
    return <span className="text-ink-muted">Unknown</span>;
  }

  const drift = schemaDrift(schema);

  return (
    <span className={drift === "Current" ? "" : "text-danger"} title={schema.name}>
      Migration {schema.migration}
      {drift !== "Current" &&
        (drift === "Newer" ? ", newer than supported" : ", older than supported")}
    </span>
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

/**
 * T3 Code projects whose folder isn't a repository FleetFrog has, such as one that was moved or
 * deleted, or one outside the project folders while finding those is off.
 */
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

function AboutPanel() {
  return (
    <SidePanel title="About">
      <SideDetail term="Built for">
        <span title={supportedT3CodeSchema.name}>
          T3 Code's schema at migration {supportedT3CodeSchema.migration}
        </span>
      </SideDetail>
      <SideDetail term="Access">
        Read-only. Each agent opens T3 Code's database for a moment on every scan, and T3 Code keeps
        working while it does.
      </SideDetail>
    </SidePanel>
  );
}

/** Whether and how FleetFrog reads T3 Code, and what it found on each machine. */
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
    <SidebarPage title="T3 Code" parents={parents} aside={<AboutPanel />}>
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
