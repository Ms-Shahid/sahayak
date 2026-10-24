# School access history

School administrators can open **Access & invitations → Access history** to see
their school's successful access changes, newest first. Teachers and students
cannot read this endpoint or see the history panel. The school is always taken
from the verified account's membership, never from a request parameter.

Recorded changes:

- School enrollment, including the initial administrator as actor.
- Invitation creation, acceptance and explicit revocation.
- New members joining through an invitation.
- Class access changes, including classes before and after the change. Accepting
  an invitation adds only missing classes; an unchanged roster creates no roster
  event.
- Member removal, including their former class IDs.
- Automatic invitation revocations after an issuer's class access changes or
  school membership is removed. Each affected invitation has its own event with
  the initiating administrator and the reason.

Each event stores an actor identity/role snapshot, action, target ID/type/label,
time, and relevant class IDs. Actor and target snapshots are not foreign keys to
members or invitations, so their deletion does not erase the history. Invitation
tokens, token hashes, request bodies and session credentials are never copied to
the audit store.

Every event is inserted in the transaction that changes access. If an audit
insert fails, the access change and any earlier events in that transaction roll
back. Rejected, expired, repeated or unauthorized operations do not create
successful-change events. This is not a failed-login or attempted-access log.

`GET /api/access-history` returns at most 50 events and `nextCursor`. Pass
`?before=<nextCursor>` to read older events, still restricted to the caller's
school. The panel polls every 30 seconds and refreshes after access mutations.
Historical changes from before this feature was enabled are not reconstructed.

## Rollout and checks

The additive `classos_access_audit` table and school/cursor index are applied by
the existing `scripts/post-merge.sh` schema push. Apply the schema before starting
the updated API. This task does not change the production database.

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test:access-audit
pnpm --filter @workspace/api-server run test:access
```

The audit suite uses isolated synthetic schools and test-only identity/fault
stubs with real Express handlers, PostgreSQL and transactions. It checks
school/role isolation, event accuracy, existing-member acceptance, replay,
expiration, automatic revocation, deletion survival, secret exclusion, cursor
pagination and rollback after audit failures. No identity or fault stub is
included in the application.
