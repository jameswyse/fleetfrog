import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

/** A directory under the system temporary folder, deleted with everything in it when the scope closes. */
export function temporaryDirectory(prefix: string) {
  return FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.makeTempDirectoryScoped({ prefix }),
  ).pipe(Effect.provide(NodeFileSystem.layer));
}
