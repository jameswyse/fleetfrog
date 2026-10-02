/**
 * Removes the user name and password a URL can carry, as `https://user:token@host/…` does, so a
 * line of Git's output never brings credentials to the hub.
 */
export function redactCredentials(text: string): string {
  return text.replace(/:\/\/[^/@\s]*@/g, "://");
}
