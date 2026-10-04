export function redactCredentials(text: string): string {
  return text.replace(/:\/\/[^/@\s]*@/g, "://");
}
