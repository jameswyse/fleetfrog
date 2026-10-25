export function StashPopInstructions({
  path,
  branch,
}: {
  readonly path: string;
  readonly branch: string | null;
}) {
  return (
    <>
      To bring them back, run <code className="font-mono">git stash pop</code> in{" "}
      <span className="font-mono break-all">{path}</span> with{" "}
      {branch === null ? "the same commit" : <span className="font-mono break-all">{branch}</span>}{" "}
      checked out.
    </>
  );
}
