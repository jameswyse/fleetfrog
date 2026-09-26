import { Schema } from "effect";

/**
 * How checkouts on different machines are recognised as the same repository.
 * A normalised `origin` remote wins; repositories without one fall back to their root commit.
 */
export const RepositoryIdentity = Schema.TaggedUnion({
  Remote: {
    host: Schema.String,
    /** Owner and repository path below the host, e.g. `acme/shop` or `group/sub/project`. */
    path: Schema.String,
  },
  RootCommit: { sha: Schema.String },
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

export const RepositoryKey = Schema.String.pipe(Schema.brand("RepositoryKey"));
export type RepositoryKey = typeof RepositoryKey.Type;

export function repositoryKey(identity: RepositoryIdentity): RepositoryKey {
  return RepositoryIdentity.match(identity, {
    Remote: ({ host, path }) => RepositoryKey.make(`remote:${host}/${path}`),
    RootCommit: ({ sha }) => RepositoryKey.make(`root:${sha}`),
  });
}
