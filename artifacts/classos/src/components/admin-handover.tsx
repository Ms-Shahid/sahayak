import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetHandovers, useCreateHandover, useRevokeHandover, useAcceptHandover,
  getGetAccountQueryKey, getGetHandoversQueryKey, type SchoolMember, type HandoverReceipt,
} from '@workspace/api-client-react';
import { Button, FormField, Panel, errMsg, inputClass } from './kit';
import { useAccount, clearWorkspaceState } from '@/lib/account';

export function AdminHandover({ members }: { members: SchoolMember[] }) {
  const { isAdmin, isTeacher } = useAccount();
  const client = useQueryClient();
  const history = useGetHandovers({ query: { queryKey: getGetHandoversQueryKey(), enabled: isAdmin, refetchInterval: 20000 } });
  const create = useCreateHandover();
  const revoke = useRevokeHandover();
  const accept = useAcceptHandover();
  const [recipientId, setRecipientId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [token, setToken] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [receipt, setReceipt] = useState<HandoverReceipt | null>(null);
  const [copied, setCopied] = useState(false);
  if (!isAdmin && !isTeacher) return null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate({ data: { recipientId: Number(recipientId), confirmation: 'TRANSFER ADMINISTRATION' } }, {
      onSuccess: result => { setReceipt(result); setCopied(false); setConfirmation(''); history.refetch(); },
    });
  };
  return <Panel title={isAdmin ? 'Hand over school administration' : 'Accept school administration'} className="access-panel"
    subtitle="Only an existing teacher in this school can become administrator. Both people must confirm.">
    {isAdmin ? <>
      <p className="token-lead">You keep administration until the recipient accepts. Afterwards you become a teacher with no class access; the new administrator can assign your classes or remove your account. Pending invitations issued by either of you will be revoked. Creating a new handover replaces any pending one.</p>
      <form className="modal-form" onSubmit={submit}>
        <FormField label="Intended recipient"><select required className={inputClass} value={recipientId} onChange={e => setRecipientId(e.target.value)}>
          <option value="">Choose a teacher</option>
          {members.filter(m => m.role === 'teacher').map(m => <option key={m.id} value={m.id}>{m.name} · {m.email}</option>)}
        </select></FormField>
        <FormField label="Type TRANSFER ADMINISTRATION to confirm"><input required className={inputClass} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="off"/></FormField>
        {create.isError && <p className="form-error">{errMsg(create.error, 'Could not start the handover.')}</p>}
        <div><Button disabled={!recipientId || confirmation !== 'TRANSFER ADMINISTRATION' || create.isPending}>Create private handover token</Button></div>
      </form>
      {receipt && <div className="modal-form" role="status">
        <p>Nothing has been emailed. Privately send this token to <strong>{receipt.handover.recipientEmail}</strong>. It is shown only now and expires {new Date(receipt.handover.expiresAt).toLocaleString()} (24 hours). The recipient must use their existing account with that verified primary email.</p>
        <div className="token-box"><input aria-label="Private handover token" readOnly value={receipt.token} onFocus={e => e.currentTarget.select()}/>
          <Button type="button" onClick={async () => {
            try { await navigator.clipboard.writeText(receipt.token); setCopied(true); }
            catch { setCopied(false); }
          }}>{copied ? 'Copied' : 'Copy token'}</Button></div>
        <Button variant="outline" onClick={() => setReceipt(null)}>Hide token</Button>
      </div>}
      {history.isLoading ? <p>Loading handovers…</p> : history.isError ? <p className="form-error">Could not load handovers. <button onClick={() => history.refetch()}>Retry</button></p>
        : history.data?.map(row => <div className="check-row" key={row.id}>
          <span>{row.recipientEmail} · {row.status} · expires {new Date(row.expiresAt).toLocaleString()}</span>
          {row.status === 'pending' && <Button variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate({ handoverId: row.id }, {
            onSuccess: () => { setReceipt(null); history.refetch(); client.invalidateQueries(); },
          })}>Cancel handover</Button>}
        </div>)}
      {revoke.isError && <p className="form-error">{errMsg(revoke.error, 'Could not cancel the handover.')}</p>}
    </> : <form className="modal-form" onSubmit={e => {
      e.preventDefault();
      accept.mutate({ data: { token: token.trim(), confirmation: 'ACCEPT ADMINISTRATION' } }, { onSuccess: async account => {
        setToken(''); setAccepted(false); clearWorkspaceState();
        await client.cancelQueries();
        client.removeQueries({ predicate: q => q.queryKey[0] !== getGetAccountQueryKey()[0] });
        client.setQueryData(getGetAccountQueryKey(), account);
      } });
    }}>
      <p>Accepting makes you administrator of your current school. The former administrator becomes a teacher with no classes. Both accounts' pending invitations are revoked.</p>
      <FormField label="Private handover token"><input required minLength={64} maxLength={64} className={inputClass} autoComplete="off" spellCheck={false} value={token} onChange={e => setToken(e.target.value)}/></FormField>
      <label><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)}/> I accept responsibility for administering this school.</label>
      {accept.isError && <p className="form-error">{errMsg(accept.error, 'Could not accept the handover.')}</p>}
      <div><Button disabled={!accepted || token.trim().length !== 64 || accept.isPending}>Accept administration</Button></div>
    </form>}
  </Panel>;
}
