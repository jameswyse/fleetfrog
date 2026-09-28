import { Effect, Stream, SubscriptionRef } from "effect";

import {
  CurrentViewer,
  DashboardRpcs,
  Forbidden,
  InvalidArchiveFolder,
  InvalidAvatar,
  ManagedByProvider,
  NotSignedIn,
  RefreshTarget,
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
import { checkPassword, hashPassword } from "../auth/passwords.ts";
import { UserStore } from "../auth/userStore.ts";
import { FleetFeed } from "../catalogue/fleetFeed.ts";
import { ProjectIconStore } from "../catalogue/projectIconStore.ts";
import { MachineStore } from "../machines/machineStore.ts";
import { PairingOffers } from "../pairing/pairingOffers.ts";
import { IntegrationsStore } from "../settings/integrationsStore.ts";
import { PollingStore } from "../settings/pollingStore.ts";
import { DashboardPresence } from "./dashboardPresence.ts";

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
    const auth = yield* AuthSettingsStore;
    const dashboardSessions = yield* DashboardSessions;
    /** The signed-in user making the call. With sign-in off there's no one to act as. */
    const signedIn = Effect.gen(function* () {
      const viewer = yield* CurrentViewer;

      return viewer._tag === "SignedIn" ? viewer : yield* new NotSignedIn();
    });
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
        }),
      RenameMachine: (rename) =>
        Effect.gen(function* () {
          const before = yield* machines.find(rename.machineId);

          yield* machines.rename(rename);
          yield* feed.invalidate;
          yield* activity.recordEvent({
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
          yield* activity.recordEvent({
            _tag: "DiscoveryRootsChanged",
            machineId: update.machineId,
            machineName: machineLabel(machine),
            roots: update.roots,
          });
        }),
      CreateProjectFolder: ({ machineId, path }) =>
        Effect.gen(function* () {
          const machine = yield* machines.find(machineId);

          // Only a folder the machine is set to search, or its Archive folder, which its agent
          // also checks.
          if (!machine.discoveryRoots.includes(path) && machine.archiveFolder !== path) {
            return FolderOutcome.cases.Failed.make({
              message: `${path} isn't one of ${machineLabel(machine)}'s project folders or its Archive folder.`,
            });
          }

          const outcome = yield* folders.create(machineId, path);

          if (outcome._tag === "Created") {
            yield* activity.recordEvent({
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
          yield* activity.recordEvent({
            _tag: "MachineRemoved",
            machineId,
            machineName: machineLabel(machine),
          });
        }),
      UpdateAgent: ({ machineId }) => updates.start(machineId),
      UpdatePolling: ({ polling: settings }) =>
        polling
          .update(settings)
          .pipe(
            Effect.andThen(activity.recordEvent({ _tag: "PollingChanged", polling: settings })),
          ),
      UpdateIntegrations: ({ integrations: settings }) =>
        integrations
          .update(settings)
          .pipe(
            Effect.andThen(
              activity.recordEvent({ _tag: "IntegrationsChanged", integrations: settings }),
            ),
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

          return yield* activity.recordEvent({
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

          return { batchId: yield* dispatcher.start(request) };
        }),
      Cancel: ({ target }) => dispatcher.cancel(target),
      WatchRuns: () => activity.watchRuns,
      WatchActivity: (query) => activity.watchActivity(query),
      WatchBatch: ({ batchId }) => activity.watchBatch(batchId),
      UpdateProfile: ({ displayName }) =>
        Effect.gen(function* () {
          const record = yield* ownRecord;

          if (record.providerName !== null) {
            return yield* new ManagedByProvider();
          }

          yield* users.setDisplayName({ userId: record.id, displayName }).pipe(Effect.orDie);

          return yield* ownRecord.pipe(Effect.flatMap(users.describe));
        }),
      SetAvatar: ({ avatar }) =>
        Effect.gen(function* () {
          const record = yield* ownRecord;

          if (record.providerPicture !== null) {
            return yield* new ManagedByProvider();
          }

          if (avatar !== null && !isAvatarImage(avatar)) {
            return yield* new InvalidAvatar();
          }

          yield* users.setAvatar({ userId: record.id, avatar }).pipe(Effect.orDie);

          return yield* ownRecord.pipe(Effect.flatMap(users.describe));
        }),
      ChangePassword: ({ currentPassword, newPassword }) =>
        Effect.gen(function* () {
          const { sessionHash } = yield* signedIn;
          const record = yield* ownRecord;

          if (!(yield* checkPassword({ password: currentPassword, hash: record.passwordHash }))) {
            return yield* new WrongPassword();
          }

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

          // Open sockets carry what the old role could see, so they close.
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
      WatchAuthSettings: () => auth.watch,
      SetGravatar: ({ enabled }) =>
        SubscriptionRef.get(auth.settings).pipe(
          Effect.flatMap((settings) => auth.update({ ...settings, gravatar: enabled })),
        ),
    };
  }),
);
