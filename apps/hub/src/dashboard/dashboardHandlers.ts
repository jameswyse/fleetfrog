import { Duration, Effect, Option, Stream, SubscriptionRef } from "effect";

import {
  CurrentViewer,
  DashboardRpcs,
  Forbidden,
  InvalidArchiveFolder,
  InvalidAvatar,
  InvalidIcon,
  ManagedByProvider,
  NotSignedIn,
  ProviderRejected,
  RefreshTarget,
  TooManyAttempts,
  viewerRole,
  WrongPassword,
} from "@fleetfrog/protocol/dashboard/rpcs";
import { batchKind } from "@fleetfrog/protocol/domain/activity";
import { checkArchiveFolder } from "@fleetfrog/protocol/domain/archiveFolder";
import { FolderOutcome, machineLabel } from "@fleetfrog/protocol/domain/fleet";
import { mayRun } from "@fleetfrog/protocol/domain/user";

import { ActionDispatcher } from "../actions/actionDispatcher.ts";
import { ActivityFeed } from "../activity/activityFeed.ts";
import { AgentSessions } from "../agents/agentSessions.ts";
import { AgentUpdates } from "../agents/agentUpdates.ts";
import { FolderRequests } from "../agents/folderRequests.ts";
import { InspectionRequests } from "../agents/inspectionRequests.ts";
import { AuthSettingsStore } from "../auth/authSettingsStore.ts";
import { isAvatarImage } from "../auth/avatarImage.ts";
import { DashboardSessions } from "../auth/dashboardSessions.ts";
import { LoginThrottle } from "../auth/loginThrottle.ts";
import { OidcSignIn } from "../auth/oidcSignIn.ts";
import { checkPassword, hashPassword } from "../auth/passwords.ts";
import { fetchProviderIcon, iconType, ProviderIconStore } from "../auth/providerIcon.ts";
import { UserStore } from "../auth/userStore.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PairingOffers } from "../pairing/pairingOffers.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { PreferencesStore } from "../settings/preferencesStore.ts";
import { ProjectLayoutStore } from "../settings/projectLayoutStore.ts";
import { DashboardPresence } from "./dashboardPresence.ts";

import type { Actor, HubEvent } from "@fleetfrog/protocol/domain/activity";

export const DashboardHandlers = DashboardRpcs.toLayer(
  Effect.gen(function* () {
    const feed = yield* FleetFeed;
    const presence = yield* DashboardPresence;
    const sessions = yield* AgentSessions;
    const machines = yield* MachineStore;
    const polling = yield* PollingStore;
    const integrations = yield* IntegrationsStore;
    const icons = yield* ProjectIconStore;
    const offers = yield* PairingOffers;
    const dispatcher = yield* ActionDispatcher;
    const activity = yield* ActivityFeed;
    const folders = yield* FolderRequests;
    const inspections = yield* InspectionRequests;
    const updates = yield* AgentUpdates;
    const users = yield* UserStore;
    const preferences = yield* PreferencesStore;
    const projectLayouts = yield* ProjectLayoutStore;
    const auth = yield* AuthSettingsStore;
    const oidc = yield* OidcSignIn;
    const throttle = yield* LoginThrottle;
    const buttonIcon = yield* ProviderIconStore;

    const useProviderIcon = (issuerUrl: string) =>
      fetchProviderIcon(issuerUrl).pipe(
        Effect.flatMap((found) =>
          buttonIcon.replace(
            Option.match(found, {
              onNone: () => null,
              onSome: ({ data, mediaType }) => ({ data, mediaType, source: "provider" as const }),
            }),
          ),
        ),
      );

    const dashboardSessions = yield* DashboardSessions;

    const signedIn = Effect.gen(function* () {
      const viewer = yield* CurrentViewer;

      return viewer._tag === "SignedIn" ? viewer : yield* new NotSignedIn();
    });

    const actor: Effect.Effect<Actor, never, CurrentViewer> = Effect.gen(function* () {
      const viewer = yield* CurrentViewer;

      if (viewer._tag === "Anyone") {
        return null;
      }

      const user = yield* users
        .find(viewer.userId)
        .pipe(Effect.flatMap(users.describe), Effect.option);

      return Option.match(user, {
        onNone: () => null,
        onSome: ({ id, displayName }) => ({ userId: id, name: displayName }),
      });
    });

    const recordChange = (event: HubEvent) =>
      actor.pipe(Effect.flatMap((by) => activity.recordEvent(event, by)));

    const ownRecord = signedIn.pipe(
      Effect.flatMap(({ userId }) => users.find(userId)),
      Effect.catchTag("UserNotFound", () => Effect.fail(new NotSignedIn())),
    );

    return {
      WatchFleet: () => Stream.unwrap(presence.watch.pipe(Effect.as(feed.watch))),
      Refresh: ({ target }) =>
        RefreshTarget.match(target, {
          All: () => sessions.refresh("all"),
          Machine: ({ machineId }) =>
            machines.find(machineId).pipe(Effect.andThen(sessions.refresh([machineId]))),
          Machines: ({ machineIds }) =>
            Effect.forEach(machineIds, machines.find).pipe(
              Effect.andThen(sessions.refresh(machineIds)),
            ),
        }),
      RenameMachine: (rename) =>
        Effect.gen(function* () {
          const before = yield* machines.find(rename.machineId);

          yield* machines.rename(rename);
          yield* feed.invalidate;
          yield* recordChange({
            _tag: "MachineRenamed",
            machineId: rename.machineId,
            from: machineLabel(before),
            to: machineLabel({ ...before, customName: rename.customName }),
          });
        }),
      SetMachineKind: (update) => machines.setKind(update).pipe(Effect.andThen(feed.invalidate)),
      SetDiscoveryRoots: (update) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(update.machineId);

          yield* machines.setDiscoveryRoots(update);
          yield* sessions.reconfigure(update.machineId);
          yield* feed.invalidate;
          yield* recordChange({
            _tag: "DiscoveryRootsChanged",
            machineId: update.machineId,
            machineName: machineLabel(machine),
            roots: update.roots,
          });
        }),
      CreateProjectFolder: ({ machineId, path }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          if (!machine.discoveryRoots.includes(path) && machine.archiveFolder !== path) {
            return FolderOutcome.cases.Failed.make({
              message: `${path} isn't one of ${machineLabel(machine)}'s project folders or its Archive folder.`,
            });
          }

          const outcome = yield* folders.create(machineId, path);

          if (outcome._tag === "Created") {
            yield* recordChange({
              _tag: "ProjectFolderCreated",
              machineId,
              machineName: machineLabel(machine),
              path,
            });
          }

          return outcome;
        }),
      InspectCheckout: ({ machineId, path, worktree }) =>
        machines
          .find(machineId)
          .pipe(Effect.andThen(inspections.inspect({ machineId, path, worktree }))),
      RemoveMachine: ({ machineId }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          yield* machines.remove(machineId);
          yield* icons.replace({ machineId, icons: [] });
          yield* sessions.disconnect(machineId);
          yield* feed.invalidate;
          yield* recordChange({
            _tag: "MachineRemoved",
            machineId,
            machineName: machineLabel(machine),
          });
        }),
      UpdateAgent: ({ machineId }) => updates.start(machineId),
      UpdatePolling: ({ polling: settings }) =>
        polling
          .update(settings)
          .pipe(Effect.andThen(recordChange({ _tag: "PollingChanged", polling: settings }))),
      UpdateIntegrations: ({ integrations: settings }) =>
        integrations
          .update(settings)
          .pipe(
            Effect.andThen(recordChange({ _tag: "IntegrationsChanged", integrations: settings })),
          ),
      SetArchiveFolder: ({ machineId, folder }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);
          const trimmed = folder?.trim() ?? null;

          if (
            trimmed !== null &&
            checkArchiveFolder({
              folder: trimmed,
              home: machine.info.homeDirectory,
              roots: machine.discoveryRoots,
            })._tag !== "Valid"
          ) {
            return yield* new InvalidArchiveFolder();
          }

          yield* machines.setArchiveFolder({ machineId, folder: trimmed });
          yield* sessions.reconfigure(machineId);
          yield* feed.invalidate;

          return yield* recordChange({
            _tag: "ArchiveFolderChanged",
            machineId,
            machineName: machineLabel(machine),
            folder: trimmed,
          });
        }),
      CreatePairingOffer: () => offers.create,
      StartBatch: ({ request }) =>
        Effect.gen(function* () {
          if (!mayRun(viewerRole(yield* CurrentViewer), batchKind(request))) {
            return yield* new Forbidden();
          }

          return { batchId: yield* dispatcher.start(request, yield* actor) };
        }),
      Cancel: ({ target }) => dispatcher.cancel(target),
      WatchRuns: () => activity.watchRuns,
      WatchActivity: (query) => activity.watchActivity(query),
      WatchBatch: ({ batchId }) => activity.watchBatch(batchId),
      UpdateProfile: ({ displayName }) =>
        Effect.gen(function* () {
          const record = yield* ownRecord;

          if ((yield* users.describe(record)).displayNameFromProvider) {
            return yield* new ManagedByProvider();
          }

          yield* users.setDisplayName({ userId: record.id, displayName }).pipe(Effect.orDie);

          return yield* ownRecord.pipe(Effect.flatMap(users.describe));
        }),
      SetAvatar: ({ avatar }) =>
        Effect.gen(function* () {
          const record = yield* ownRecord;

          if ((yield* users.describe(record)).avatar._tag === "Provider") {
            return yield* new ManagedByProvider();
          }

          if (avatar !== null && !isAvatarImage(avatar)) {
            return yield* new InvalidAvatar();
          }

          yield* users.setAvatar({ userId: record.id, avatar }).pipe(Effect.orDie);

          return yield* ownRecord.pipe(Effect.flatMap(users.describe));
        }),
      SetPreferences: (payload) =>
        Effect.gen(function* () {
          if ((yield* CurrentViewer)._tag === "Anyone") {
            return yield* preferences.set(null, payload.preferences);
          }

          const record = yield* ownRecord;

          return yield* preferences.set(record.id, payload.preferences);
        }),
      SetProjectLayout: ({ layout, revision }) =>
        Effect.gen(function* () {
          const userId = (yield* CurrentViewer)._tag === "Anyone" ? null : (yield* ownRecord).id;

          return { revision: yield* projectLayouts.save(userId, layout, revision) };
        }),
      ChangePassword: ({ currentPassword, newPassword }) =>
        Effect.gen(function* () {
          const { sessionHash } = yield* signedIn;
          const record = yield* ownRecord;
          const attempt = { email: record.email, address: null };
          const wait = yield* throttle.reserve(attempt);

          if (Option.isSome(wait)) {
            return yield* new TooManyAttempts({
              retryAfterSeconds: Math.ceil(Duration.toSeconds(wait.value)),
            });
          }

          if (!(yield* checkPassword({ password: currentPassword, hash: record.passwordHash }))) {
            return yield* new WrongPassword();
          }

          yield* throttle.succeeded(attempt);

          yield* users
            .setPasswordHash({ userId: record.id, passwordHash: yield* hashPassword(newPassword) })
            .pipe(Effect.orDie);

          return yield* dashboardSessions.endForUser(record.id, { except: sessionHash });
        }),
      WatchUsers: () => users.watch,
      CreateUser: ({ password, ...user }) =>
        Effect.gen(function* () {
          const passwordHash = password === null ? null : yield* hashPassword(password);

          return yield* users
            .create({ ...user, passwordHash })
            .pipe(Effect.flatMap(users.describe));
        }),
      UpdateUser: (update) =>
        Effect.gen(function* () {
          const before = yield* users.find(update.userId);

          yield* users.update(update);

          if (before.role !== update.role) {
            yield* dashboardSessions.endForUser(update.userId);
          }
        }),
      SetUserPassword: ({ userId, password }) =>
        Effect.gen(function* () {
          yield* users.setPasswordHash({ userId, passwordHash: yield* hashPassword(password) });
          yield* dashboardSessions.endForUser(userId);
        }),
      DeleteUser: ({ userId }) =>
        users.remove(userId).pipe(Effect.andThen(dashboardSessions.endForUser(userId))),
      WatchAuthSettings: () =>
        Stream.zipLatest(auth.watch, SubscriptionRef.changes(buttonIcon.current)).pipe(
          Stream.map(([settings, icon]) => ({ ...settings, icon })),
        ),
      SetOidcSettings: ({ settings: input }) =>
        Effect.gen(function* () {
          const current = yield* SubscriptionRef.get(auth.settings);

          const saved =
            current.oidc?.issuerUrl === input.issuerUrl && current.oidc.clientId === input.clientId
              ? current.oidc.clientSecret
              : null;

          const clientSecret = input.clientSecret ?? saved;

          if (clientSecret === null) {
            return yield* new ProviderRejected({
              message:
                current.oidc === null
                  ? "Enter the client secret."
                  : "Enter the client secret again, since the issuer URL or client ID changed.",
            });
          }

          const settings = { ...input, clientSecret };

          yield* oidc
            .check(settings)
            .pipe(Effect.mapError(({ detail }) => new ProviderRejected({ message: detail })));

          yield* auth.update({ ...current, oidc: settings });

          return (yield* SubscriptionRef.get(buttonIcon.current))?.source === "uploaded"
            ? undefined
            : yield* useProviderIcon(settings.issuerUrl);
        }),
      SetProviderIcon: ({ icon }) =>
        Effect.gen(function* () {
          if (icon === null) {
            const { oidc: saved } = yield* SubscriptionRef.get(auth.settings);

            return yield* saved === null
              ? buttonIcon.replace(null)
              : useProviderIcon(saved.issuerUrl);
          }

          const mediaType = iconType(icon);

          if (mediaType === null) {
            return yield* new InvalidIcon();
          }

          return yield* buttonIcon.replace({ data: icon, mediaType, source: "uploaded" });
        }),
      SetGravatar: ({ enabled }) =>
        SubscriptionRef.get(auth.settings).pipe(
          Effect.flatMap((settings) => auth.update({ ...settings, gravatar: enabled })),
        ),
    };
  }),
);
