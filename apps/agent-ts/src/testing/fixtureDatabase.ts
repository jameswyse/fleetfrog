import { DatabaseSync } from "node:sqlite";

export function openFixtureDatabase(file: string) {
  const database = new DatabaseSync(file);

  database.exec("pragma synchronous = off");

  return database;
}
