import { currentInstance } from "./environment.ts";

export function isValidInstanceName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

export function instanceNamed(base: string): string {
  const name = currentInstance();

  return name === undefined ? base : `${base}-${name}`;
}
