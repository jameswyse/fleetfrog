import { Schema } from "effect";

export const RepositoryIdentity = Schema.TaggedUnion({
  Remote: {
    host: Schema.String,
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
