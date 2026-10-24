# School administrator handover

School access → Hand over school administration lets the current administrator
choose an existing teacher in the same school and type `TRANSFER ADMINISTRATION`.
The resulting private token must be shared manually; ClassOS sends no email.
Only its hash is stored, it expires after 24 hours, and a new handover revokes
any previous pending handover for the school. Administrators can cancel a
pending handover.

The teacher signs into their own existing account, opens School access, pastes
the token, and confirms responsibility. Clerk must verify their primary email;
both their account ID and verified email must match the intended recipient.
Students and accounts in other schools cannot accept or be selected.

Acceptance promotes the recipient and demotes the issuing administrator to a
teacher **with no classes**, in one database transaction. The new administrator
can then assign classes to or remove the former administrator. Until acceptance,
the current administrator keeps all their existing access. Direct removal of an
administrator remains forbidden.

Acceptance consumes the credential, revokes other pending handovers and pending
invitations issued by either participant, and writes an access-history event in
the same transaction. Audit failure rolls everything back. Access-management
writers serialize on a school lock and re-check current authorization, so a
request queued behind a transfer cannot act with its old administrator role.
The recipient's existing teacher class roster remains intact; the former
administrator gets no implicit class access.

## Schema and checks

Apply the additive `classos_admin_handovers` table through the existing schema
rollout (`pnpm --filter @workspace/db run push` in development). The post-merge
script uses the project's usual schema push. Production schema changes follow
the normal approved release process; do not copy development or production
identities between environments.

`pnpm --filter @workspace/api-server run test:handovers` runs isolated synthetic
identity tests against development PostgreSQL. It never creates Clerk users or
changes production data. Existing `test:access` and `test:access-audit` remain
authorization regression checks.
