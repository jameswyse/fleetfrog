import { Effect } from "effect";
import { SqlClient } from "effect/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    insert into hub_events (at, machine_id, event_json)
    select event.at, machine.id, json_object(
      '_tag', 'ArchiveFolderChanged',
      'machineId', machine.id,
      'machineName', coalesce(
        machine.custom_name,
        machine.info_json ->> '$.prettyName',
        machine.info_json ->> '$.hostname'
      ),
      'folder', event.event_json ->> '$.folder'
    )
    from hub_events as event
    join machines as machine on machine.paired_at <= event.at
    where event.machine_id is null and event.event_json ->> '$._tag' = 'ArchiveFolderChanged'
  `;
  yield* sql`
    delete from hub_events
    where machine_id is null and event_json ->> '$._tag' = 'ArchiveFolderChanged'
  `;
});
