import { Context, Schema } from "effect";
import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";

import {
  ActivityFilter,
  ActivityPage,
  BatchDetail,
  BatchId,
  BatchRequest,
  RunId,
  RunsSnapshot,
} from "../domain/activity.ts";
import { Fleet, FolderOutcome } from "../domain/fleet.ts";
import { MachineId, MachineKind } from "../domain/machine.ts";
import { PollingSettings } from "../domain/polling.ts";
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
  Role,
  User,
  UserId,
} from "../domain/user.ts";

/**
 * Who may call an RPC. RPCs are for admins unless marked for users, so a new one starts closed to
 * users.
 */
export const Access = Context.Reference<Role>("fleetfrog/Access", { defaultValue: () => "admin" });

/** Who is calling. With sign-in off, anyone who can reach the dashboard is an admin. */
export type Viewer =
  | { readonly _tag: "Anyone" }
  | {
      readonly _tag: "SignedIn";
      readonly userId: UserId;
      readonly role: Role;
      /** Identifies the session, so a password change can keep it and end the others. */
      readonly sessionHash: string;
    };

export function viewerRole(viewer: Viewer): Role {
  return viewer._tag === "Anyone" ? "admin" : viewer.role;
}

export class CurrentViewer extends Context.Service<CurrentViewer, Viewer>()(
  "fleetfrog/CurrentViewer",
) {}

/** The session has ended or sign-in was turned on, so the dashboard needs to sign in again. */
export class NotSignedIn extends Schema.TaggedError<NotSignedIn>()("NotSignedIn", {}) {}

export class Forbidden extends Schema.TaggedError<Forbidden>()("Forbidden", {}) {}

/** Reads the session cookie sent with the WebSocket upgrade, and checks the RPC's `Access`. */
export class DashboardAuthentication extends RpcMiddleware.Service<
  DashboardAuthentication,
  { provides: CurrentViewer }
>()("fleetfrog/DashboardAuthentication", { error: Schema.Union([NotSignedIn, Forbidden]) }) {}

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  userId: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", {}) {}

/** The change would leave the hub without an admin. */
export class LastAdmin extends Schema.TaggedError<LastAdmin>()("LastAdmin", {}) {}

export class WrongPassword extends Schema.TaggedError<WrongPassword>()("WrongPassword", {}) {}

/** Too many wrong passwords in a row, so the next try has to wait. */
export class TooManyAttempts extends Schema.TaggedError<TooManyAttempts>()("TooManyAttempts", {
  retryAfterSeconds: Schema.Int,
}) {}

/** The sign-in provider sets this on every sign-in, so it can't be changed here. */
export class ManagedByProvider extends Schema.TaggedError<ManagedByProvider>()(
  "ManagedByProvider",
  {},
) {}

/** The provider didn't answer discovery at its issuer URL, or there's no client secret yet. */
export class ProviderRejected extends Schema.TaggedError<ProviderRejected>()("ProviderRejected", {
  message: Schema.String,
}) {}

/** The file isn't a PNG, JPEG or WebP image, or is too large. */
export class InvalidAvatar extends Schema.TaggedError<InvalidAvatar>()("InvalidAvatar", {}) {}

export class MachineNotFound extends Schema.TaggedError<MachineNotFound>()("MachineNotFound", {
  machineId: MachineId,
}) {}

export class RepositoryNotFound extends Schema.TaggedError<RepositoryNotFound>()(
  "RepositoryNotFound",
  { repositoryKey: RepositoryKey },
) {}

/** The scope matched no checkouts, so there was nothing to run. */
export class NothingToRun extends Schema.TaggedError<NothingToRun>()("NothingToRun", {}) {}

/** No checkout of the repository has an HTTPS or SSH origin to clone from. */
export class NoCloneSource extends Schema.TaggedError<NoCloneSource>()("NoCloneSource", {}) {}

/** The folder can't hold archived checkouts on the machine, such as because it holds a project folder. */
export class InvalidArchiveFolder extends Schema.TaggedError<InvalidArchiveFolder>()(
  "InvalidArchiveFolder",
  {},
) {}

/**
 * The hub can't update the machine's agent now: it's offline, built from source, not allowed to
 * update by its owner, already updating or already on the hub's version.
 */
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

/** How many activity entries a page starts with, and how many more each "Show older" adds. */
export const activityPageSize = 50;
/** The most activity entries one stream sends. */
export const activityLimit = 1000;

export const RefreshTarget = Schema.TaggedUnion({
  All: {},
  Machine: { machineId: MachineId },
});
export type RefreshTarget = typeof RefreshTarget.Type;

/** Where agents should connect, as far as the hub knows. */
export const AgentEndpoint = Schema.TaggedUnion({
  /** An explicitly configured public URL, e.g. behind a reverse proxy. */
  Url: { url: Schema.String },
  /** The same host the dashboard was loaded from, on the agent port. */
  DashboardHost: { scheme: Schema.Literals(["wss", "ws"]), port: Schema.Int },
});
export type AgentEndpoint = typeof AgentEndpoint.Type;

export const PairingOffer = Schema.Struct({
  code: Schema.String,
  certificateFingerprint: Schema.NullOr(Schema.String),
  endpoint: AgentEndpoint,
  expiresAt: Schema.DateTimeUtc,
});
export type PairingOffer = typeof PairingOffer.Type;

/** Served over WebSocket on the dashboard port. */
export class DashboardRpcs extends RpcGroup.make(
  /** Streams the whole fleet on subscribe and after every change. Agents poll faster while any subscription is open. */
  Rpc.make("WatchFleet", { success: Fleet, stream: true }).annotate(Access, "user"),
  Rpc.make("Refresh", { payload: { target: RefreshTarget }, error: MachineNotFound }).annotate(
    Access,
    "user",
  ),
  Rpc.make("RenameMachine", {
    payload: { machineId: MachineId, customName: Schema.NullOr(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  /** A null kind follows what the agent detects. */
  Rpc.make("SetMachineKind", {
    payload: { machineId: MachineId, kind: Schema.NullOr(MachineKind) },
    error: MachineNotFound,
  }),
  Rpc.make("SetDiscoveryRoots", {
    payload: { machineId: MachineId, roots: Schema.Array(Schema.NonEmptyString) },
    error: MachineNotFound,
  }),
  /**
   * Asks the machine to create one of its project folders, or its Archive folder, for one it lacks. Any problem on the way,
   * such as the machine being offline, comes back as a failed outcome with its reason.
   */
  Rpc.make("CreateProjectFolder", {
    payload: { machineId: MachineId, path: Schema.NonEmptyString },
    success: FolderOutcome,
    error: MachineNotFound,
  }),
  Rpc.make("RemoveMachine", { payload: { machineId: MachineId }, error: MachineNotFound }),
  /**
   * Asks the machine's agent to update to the hub's version. The fleet shows how it goes, until
   * the agent reconnects on the new version.
   */
  Rpc.make("UpdateAgent", {
    payload: { machineId: MachineId },
    error: Schema.Union([MachineNotFound, AgentNotUpdatable]),
  }),
  /**
   * Asks the machine what deleting one of its checkouts would lose, or with `worktree`, what
   * removing that linked worktree of it would. Inspecting a checkout fetches first, so it can take
   * a while. Any problem on the way comes back as a failed result with its reason.
   */
  Rpc.make("InspectCheckout", {
    payload: { machineId: MachineId, path: Schema.String, worktree: Schema.NullOr(Schema.String) },
    success: InspectionResult,
    error: MachineNotFound,
  }),
  Rpc.make("UpdatePolling", { payload: { polling: PollingSettings } }),
  Rpc.make("UpdateIntegrations", { payload: { integrations: IntegrationSettings } }),
  /** A null folder turns archiving off. Checkouts already in the old folder stay where they are. */
  Rpc.make("SetArchiveFolder", {
    payload: { machineId: MachineId, folder: Schema.NullOr(Schema.NonEmptyString) },
    error: Schema.Union([MachineNotFound, InvalidArchiveFolder]),
  }),
  Rpc.make("CreatePairingOffer", { success: PairingOffer }),
  /** Users can start only `git`-tier actions. */
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
  /** Cancelling a run that has already finished does nothing. */
  Rpc.make("Cancel", { payload: { target: CancelTarget } }).annotate(Access, "user"),
  /** Streams active runs and each checkout's latest result on subscribe and after every change. */
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
  /** Changes the signed-in user's own name. */
  Rpc.make("UpdateProfile", {
    payload: { displayName: DisplayName },
    success: User,
    error: Schema.Union([NotSignedIn, ManagedByProvider]),
  }).annotate(Access, "user"),
  /** Replaces or, with null, removes the signed-in user's own picture. */
  Rpc.make("SetAvatar", {
    payload: {
      avatar: Schema.NullOr(Schema.Struct({ mediaType: AvatarMediaType, data: Schema.Uint8Array })),
    },
    success: User,
    error: Schema.Union([NotSignedIn, ManagedByProvider, InvalidAvatar]),
  }).annotate(Access, "user"),
  /** Ends the user's other sessions. */
  Rpc.make("ChangePassword", {
    payload: { currentPassword: Schema.String, newPassword: Password },
    error: Schema.Union([NotSignedIn, WrongPassword, TooManyAttempts]),
  }).annotate(Access, "user"),
  /** Streams every user on subscribe and after every change. */
  Rpc.make("WatchUsers", { success: Schema.Array(User), stream: true }),
  /** A user without a password can sign in only through the provider. */
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
  /** A role change ends the user's sessions, so they sign in again with the new role. */
  Rpc.make("UpdateUser", {
    payload: { userId: UserId, email: Email, displayName: DisplayName, role: Role },
    error: Schema.Union([UserNotFound, EmailTaken, LastAdmin]),
  }),
  /** Ends the user's sessions. */
  Rpc.make("SetUserPassword", {
    payload: { userId: UserId, password: Password },
    error: UserNotFound,
  }),
  Rpc.make("DeleteUser", {
    payload: { userId: UserId },
    error: Schema.Union([UserNotFound, LastAdmin]),
  }),
  /** Streams the sign-in settings on subscribe and after every change. Modes change over HTTP. */
  Rpc.make("WatchAuthSettings", { success: AuthSettingsView, stream: true }),
  Rpc.make("SetGravatar", { payload: { enabled: Schema.Boolean } }),
  /** Checks the provider answers, then saves its settings. Turning it on happens over HTTP. */
  Rpc.make("SetOidcSettings", { payload: { settings: OidcInput }, error: ProviderRejected }),
).middleware(DashboardAuthentication) {}
