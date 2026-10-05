import { Context, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/rpc";

import {
  ActivityFilter,
  ActivityPage,
  BatchDetail,
  BatchId,
  BatchRequest,
  RunId,
  RunsSnapshot,
} from "../domain/activity.ts";
import { Count } from "../domain/count.ts";
import { Fleet, FolderOutcome } from "../domain/fleet.ts";
import { MachineId, MachineKind } from "../domain/machine.ts";
import { PollingSettings } from "../domain/polling.ts";
import { Preferences } from "../domain/preferences.ts";
import { ProjectLayout, SavedProjectLayout } from "../domain/projectLayout.ts";
import { RepositoryKey } from "../domain/repositoryIdentity.ts";
import { IntegrationSettings } from "../domain/t3Code.ts";
import { InspectionResult } from "../domain/trash.ts";
import {
  AuthSettingsView,
  AvatarMediaType,
  DisplayName,
  OidcInput,
  Email,
  Password,
  PasswordAttempt,
  Role,
  User,
  UserId,
} from "../domain/user.ts";

export const Access = Context.Reference<Role>("fleetfrog/Access", { defaultValue: () => "admin" });

export type Viewer =
  | { readonly _tag: "Anyone" }
  | {
      readonly _tag: "SignedIn";
      readonly userId: UserId;
      readonly role: Role;
      readonly sessionHash: string;
    };

export function viewerRole(viewer: Viewer): Role {
  return viewer._tag === "Anyone" ? "admin" : viewer.role;
}

export class CurrentViewer extends Context.Service<CurrentViewer, Viewer>()(
  "fleetfrog/CurrentViewer",
) {}

export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", {}) {}

export class ProjectLayoutChanged extends Schema.TaggedError<ProjectLayoutChanged>()(
  "ProjectLayoutChanged",
  { current: SavedProjectLayout },
) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

export class DashboardAuthentication extends RpcMiddleware.Service<
  DashboardAuthentication,
  { provides: CurrentViewer }
>()("fleetfrog/DashboardAuthentication", { error: Schema.Union([NotSignedIn, Forbidden]) }) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", {}) {}

export class LastAdmin extends Schema.TaggedError<LastAdmin>()("LastAdmin", {}) {}

export class WrongPassword extends Schema.TaggedError<WrongPassword>()("WrongPassword", {}) {}

export class TooManyAttempts extends Schema.TaggedError<TooManyAttempts>()("TooManyAttempts", {
  retryAfterSeconds: Schema.Int,
}) {}

export class ManagedByProvider extends Schema.TaggedError<ManagedByProvider>()(
  "ManagedByProvider",
  {},
) {}

export class ProviderRejected extends Schema.TaggedError<ProviderRejected>()("ProviderRejected", {
  message: Schema.String,
}) {}

export class InvalidIcon extends Schema.TaggedError<InvalidIcon>()("InvalidIcon", {}) {}

export class InvalidAvatar extends Schema.TaggedError<InvalidAvatar>()("InvalidAvatar", {}) {}

export class TailscaleServeUnavailable extends Schema.TaggedError<TailscaleServeUnavailable>()(
  "TailscaleServeUnavailable",
  { message: Schema.String },
) {}

export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()("MachineNotFound", {
  machineId: MachineId,
}) {}

export class RepositoryNotFound extends Schema.TaggedError<RepositoryNotFound>()(
  "RepositoryNotFound",
  { repositoryKey: RepositoryKey },
) {}

export class NothingToRun extends Schema.TaggedError<NothingToRun>()("NothingToRun", {}) {}

export class NoCloneSource extends Schema.TaggedError<NoCloneSource>()("NoCloneSource", {}) {}

export class InvalidArchiveFolder extends Schema.TaggedError<InvalidArchiveFolder>()(
  "InvalidArchiveFolder",
  {},
) {}

export class AgentNotUpdatable extends Schema.TaggedError<AgentNotUpdatable>()(
  "AgentNotUpdatable",
  { machineId: MachineId },
) {}

export class BatchNotFound extends Schema.TaggedError<BatchNotFound>()("BatchNotFound", {
  batchId: BatchId,
}) {}

export const CancelTarget = Schema.TaggedUnion({
  Batch: { batchId: BatchId },
  Run: { runId: RunId },
});
export type CancelTarget = typeof CancelTarget.Type;

export const activityPageSize = 50;
export const activityLimit = 1000;

export const RefreshTarget = Schema.TaggedUnion({
  All: {},
  Machine: { machineId: MachineId },
  Machines: { machineIds: Schema.NonEmptyArray(MachineId).check(Schema.isMaxLength(1000)) },
});
export type RefreshTarget = typeof RefreshTarget.Type;

export const AgentEndpoint = Schema.TaggedUnion({
  Url: { url: Schema.String },
  DashboardHost: { scheme: Schema.Literals(["wss", "ws"]), port: Schema.Int },
  Tailnet: { url: Schema.String },
});
export type AgentEndpoint = typeof AgentEndpoint.Type;

export const PairingOffer = Schema.Struct({
  code: Schema.String,
  certificateFingerprint: Schema.NullOr(Schema.String),
  endpoint: AgentEndpoint,
  expiresAt: Schema.DateTimeUtc,
});
export type PairingOffer = typeof PairingOffer.Type;

export class DashboardRpcs extends RpcGroup.make(
  Rpc.make("WatchFleet", { success: Fleet, stream: true }).annotate(Access, "user"),
  Rpc.make("Refresh", { payload: { target: RefreshTarget }, error: MachineNotFound }).annotate(
    Access,
    "user",
  ),
  Rpc.make("RenameMachine", {
    payload: { machineId: MachineId, customName: Schema.NullOr(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  Rpc.make("SetMachineKind", {
    payload: { machineId: MachineId, kind: Schema.NullOr(MachineKind) },
    error: MachineNotFound,
  }),
  Rpc.make("SetDiscoveryRoots", {
    payload: { machineId: MachineId, roots: Schema.Array(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  Rpc.make("CreateProjectFolder", {
    payload: { machineId: MachineId, path: Schema.NonEmptyString },
    success: FolderOutcome,
    error: MachineNotFound,
  }),
  Rpc.make("RemoveMachine", { payload: { machineId: MachineId }, error: MachineNotFound }),
  Rpc.make("UpdateAgent", {
    payload: { machineId: MachineId },
    error: Schema.Union([MachineNotFound, AgentNotUpdatable]),
  }),
  Rpc.make("InspectCheckout", {
    payload: { machineId: MachineId, path: Schema.String, worktree: Schema.NullOr(Schema.String) },
    success: InspectionResult,
    error: MachineNotFound,
  }),
  Rpc.make("UpdatePolling", { payload: { polling: PollingSettings } }),
  Rpc.make("UpdateIntegrations", { payload: { integrations: IntegrationSettings } }),
  Rpc.make("SetArchiveFolder", {
    payload: { machineId: MachineId, folder: Schema.NullOr(Schema.NonEmptyString) },
    error: Schema.Union([MachineNotFound, InvalidArchiveFolder]),
  }),
  Rpc.make("CreatePairingOffer", { success: PairingOffer, error: TailscaleServeUnavailable }),
  Rpc.make("StartBatch", {
    payload: { request: BatchRequest },
    success: Schema.Struct({ batchId: BatchId }),
    error: Schema.Union([
      MachineNotFound,
      RepositoryNotFound,
      NothingToRun,
      NoCloneSource,
      Forbidden,
    ]),
  }).annotate(Access, "user"),
  Rpc.make("Cancel", { payload: { target: CancelTarget } }).annotate(Access, "user"),
  Rpc.make("WatchRuns", { success: RunsSnapshot, stream: true }).annotate(Access, "user"),
  Rpc.make("WatchActivity", {
    payload: {
      filter: ActivityFilter,
      limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: activityLimit })),
    },
    success: ActivityPage,
    stream: true,
  }).annotate(Access, "user"),
  Rpc.make("WatchBatch", {
    payload: { batchId: BatchId },
    success: BatchDetail,
    error: BatchNotFound,
    stream: true,
  }).annotate(Access, "user"),
  Rpc.make("UpdateProfile", {
    payload: { displayName: DisplayName },
    success: User,
    error: Schema.Union([NotSignedIn, ManagedByProvider]),
  }).annotate(Access, "user"),
  Rpc.make("SetAvatar", {
    payload: {
      avatar: Schema.NullOr(Schema.Struct({ mediaType: AvatarMediaType, data: Schema.Uint8Array })),
    },
    success: User,
    error: Schema.Union([NotSignedIn, ManagedByProvider, InvalidAvatar]),
  }).annotate(Access, "user"),
  Rpc.make("SetPreferences", {
    payload: { preferences: Preferences },
    error: NotSignedIn,
  }).annotate(Access, "user"),
  Rpc.make("SetProjectLayout", {
    payload: { layout: ProjectLayout, revision: Count },
    success: Schema.Struct({ revision: Count }),
    error: Schema.Union([NotSignedIn, ProjectLayoutChanged]),
  }).annotate(Access, "user"),
  Rpc.make("ChangePassword", {
    payload: { currentPassword: PasswordAttempt, newPassword: Password },
    error: Schema.Union([NotSignedIn, WrongPassword, TooManyAttempts]),
  }).annotate(Access, "user"),
  Rpc.make("WatchUsers", { success: Schema.Array(User), stream: true }),
  Rpc.make("CreateUser", {
    payload: {
      email: Email,
      displayName: DisplayName,
      role: Role,
      password: Schema.NullOr(Password),
    },
    success: User,
    error: EmailTaken,
  }),
  Rpc.make("UpdateUser", {
    payload: { userId: UserId, email: Email, displayName: DisplayName, role: Role },
    error: Schema.Union([UserNotFound, EmailTaken, LastAdmin]),
  }),
  Rpc.make("SetUserPassword", {
    payload: { userId: UserId, password: Password },
    error: UserNotFound,
  }),
  Rpc.make("DeleteUser", {
    payload: { userId: UserId },
    error: Schema.Union([UserNotFound, LastAdmin]),
  }),
  Rpc.make("WatchAuthSettings", { success: AuthSettingsView, stream: true }),
  Rpc.make("SetGravatar", { payload: { enabled: Schema.Boolean } }),
  Rpc.make("SetProviderIcon", {
    payload: { icon: Schema.NullOr(Schema.Uint8Array) },
    error: InvalidIcon,
  }),
  Rpc.make("SetOidcSettings", { payload: { settings: OidcInput }, error: ProviderRejected }),
).middleware(DashboardAuthentication) {}
