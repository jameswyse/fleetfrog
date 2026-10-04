import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

export function temporaryDirectory(prefix: string) {
  return FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.makeTempDirectoryScoped({ prefix }).pipe(Effect.flatMap(fileSystem.realPath)),
  ).pipe(Effect.provide(NodeFileSystem.layer));
}
