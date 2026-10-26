export function StashPopInstructions({
  path,
  branch,
}: {
  readonly path: string;
  readonly branch: string | null;
}) {
  return (
    <>
      To bring them back, check out{" "}
      {branch === null ? "the same commit" : <span className="font-mono break-all">{branch}</span>}{" "}
      in <span className="font-mono break-all">{path}</span>, find FleetFrog's stash for this in{" "}
      <code className="font-mono">git stash list</code>, and run{" "}
      <code className="font-mono">git stash pop --index 'stash@&#123;n&#125;'</code> with its
      number.
    </>
  );
}
