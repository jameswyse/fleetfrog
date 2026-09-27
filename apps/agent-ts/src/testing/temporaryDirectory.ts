import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";

/**
 * A directory under the system temporary folder, deleted with everything in it when the scope
 * closes. Returned with symbolic links resolved, as Git reports paths, since macOS keeps its
 * temporary folder behind `/var -> /private/var`.
 */
export function temporaryDirectory(prefix: string) {
  return FileSystem.FileSystem.use((fileSystem) =>
    fileSystem.makeTempDirectoryScoped({ prefix }).pipe(Effect.flatMap(fileSystem.realPath)),
  ).pipe(Effect.provide(NodeFileSystem.layer));
}
