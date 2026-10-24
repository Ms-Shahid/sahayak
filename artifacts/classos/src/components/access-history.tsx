import { useState } from 'react';
import { History } from 'lucide-react';
import { getGetAccessHistoryQueryKey, useGetAccessHistory } from '@workspace/api-client-react';
import type { AccessAuditEvent } from '@workspace/api-client-react';
import { Button, Empty, Loading, Panel } from './kit';

const actions: Record<AccessAuditEvent['action'], string> = {
  'school.enrolled': 'School enrolled',
  'invitation.created': 'Invitation created',
  'invitation.accepted': 'Invitation accepted',
  'invitation.revoked': 'Invitation revoked',
  'member.joined': 'Member joined',
  'member.removed': 'Member removed',
  'roster.updated': 'Class access updated',
};
const reasons: Record<AccessAuditEvent['reason'], string> = {
  direct: '', invitation_acceptance: 'Invitation accepted',
  roster_change: 'Automatically revoked after class access changed',
  member_removal: 'Automatically revoked when issuer was removed',
};

// Mount only for administrators; never request history from teacher/student views.
export function AccessHistoryPanel({ classNameFor }: { classNameFor: (id: number) => string }) {
  const [cursors, setCursors] = useState<number[]>([]);
  const before = cursors.at(-1);
  const params = before ? { before } : undefined;
  const history = useGetAccessHistory(params, {
    query: { queryKey: getGetAccessHistoryQueryKey(params), refetchInterval: 30000, staleTime: 0 },
  });
  const classes = (ids: number[]) => ids.length
    ? ids.map(id => `${classNameFor(id)} (#${id})`).join(', ') : 'No classes';
  return <Panel title="Access history" subtitle="Administrator-only history for this school, newest first. Recording starts when this feature is enabled; earlier changes are not reconstructed." className="access-panel">
    {history.isLoading ? <Loading/> : history.isError
      ? <div className="inline-error">Access history is unavailable. <button className="text-link" onClick={() => history.refetch()}>Retry</button></div>
      : history.data?.events.length ? <div className="table-wrap"><table className="data-table">
        <thead><tr><th>When</th><th>Changed by</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{history.data.events.map(event => <tr key={event.id} data-testid={`row-access-event-${event.id}`}>
          <td><time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></td>
          <td><strong>{event.actorName}</strong><br/><small>{event.actorEmail} · {event.actorRole}</small></td>
          <td>{actions[event.action]}</td>
          <td>{event.targetLabel}<br/><small>{event.targetType} #{event.targetId}{event.targetRole ? ` · ${event.targetRole}` : ''}</small></td>
          <td>{event.action === 'roster.updated'
            ? <><small>Before: {classes(event.beforeClassIds)}</small><br/><small>After: {classes(event.afterClassIds)}</small></>
            : (event.beforeClassIds.length || event.afterClassIds.length) > 0
              ? <small>{classes(event.afterClassIds.length ? event.afterClassIds : event.beforeClassIds)}</small> : null}
            {reasons[event.reason] && <><br/><small>{reasons[event.reason]}</small></>}
          </td>
        </tr>)}</tbody>
      </table></div> : <Empty icon={History} title="No access changes recorded yet" detail="Future enrollment, invitation, roster and removal changes will appear here."/>}
    <div className="modal-actions">
      {cursors.length > 0 && <Button variant="outline" onClick={() => setCursors([])}>Newest events</Button>}
      <Button variant="outline" disabled={history.isFetching || !history.data?.nextCursor} onClick={() => {
        if (history.data?.nextCursor) setCursors([...cursors, history.data.nextCursor]);
      }}>Older events</Button>
    </div>
  </Panel>;
}
