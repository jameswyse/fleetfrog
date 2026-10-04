import { Schema } from "effect";

import { SignInFailure } from "@fleetfrog/protocol/dashboard/auth";

const copy = {
  ProviderOff: "Signing in through a provider is off. Sign in another way.",
  NotSetUp: "No sign-in provider is set up. Sign in another way.",
  OtherBrowser: "That sign-in started in another browser. Try again here.",
  Expired: "That sign-in took too long or was already used. Try again.",
  SignInOff: "FLEETFROG_AUTH_MODE on the hub keeps sign-in off.",
  ProviderUnreachable:
    "FleetFrog couldn't reach the sign-in provider. Try again later. The hub's log has the details.",
  ProviderRefused: "The provider didn't sign you in. Try again. The hub's log has the details.",
  Incomplete:
    "The provider didn't finish signing you in. Try again. The hub's log has the details.",
  NoIdentity: "The provider didn't say who signed in. Check the provider's FleetFrog application.",
  NoEmail: "The provider didn't share an email address. Allow FleetFrog the email scope.",
  NotInRequiredGroup: "Your provider account isn't in the group that can sign in to FleetFrog.",
  NotInAdminGroup:
    "You aren't in the provider's admin group, so turning this on would lock you out of Settings.",
  EmailTaken:
    "Another FleetFrog user already has your email. If it's yours, ask your provider's admin to mark it verified.",
} satisfies Record<SignInFailure, string>;

const isSignInFailure = Schema.is(SignInFailure);

export function signInFailureMessage(failure: string | undefined): string | null {
  return failure !== undefined && isSignInFailure(failure) ? copy[failure] : null;
}
