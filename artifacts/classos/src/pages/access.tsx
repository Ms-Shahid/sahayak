import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, Mail, Pencil, UserMinus, Users } from 'lucide-react';
import {
  useGetMembers, useUpdateMemberClasses, useRemoveMember, useGetInvitations, useCreateInvitation,
  useRevokeInvitation, useGetClasses, useAcceptInvitation, getGetMembersQueryKey, getGetInvitationsQueryKey,
  getGetClassesQueryKey, getGetAccountQueryKey,
} from '@workspace/api-client-react';
import type { Classroom, InvitationReceipt, SchoolMember } from '@workspace/api-client-react';
import { Button, Empty, FormField, Loading, Modal, PageHeading, Panel, errMsg, inputClass, initials } from '@/components/kit';
import { useAccount } from '@/lib/account';

function ClassChecklist({ classes, value, onChange }: { classes: Classroom[]; value: number[]; onChange: (ids: number[]) => void }) {
  if (!classes.length) return <p className="subtle-empty">No class spaces available yet.</p>;
  return <div className="check-list">{classes.map(c => { const on = value.includes(c.id); return <label key={c.id} className={`check-row ${on ? 'check-on' : ''}`}><input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter(i => i !== c.id) : [...value, c.id])}/><span className="check-box">{on && <Check size={12}/>}</span><span><strong>{c.name}</strong><small>{c.subject} · Grade {c.grade}</small></span></label>; })}</div>;
}

function TokenModal({ receipt, onClose }: { receipt: InvitationReceipt; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(receipt.token); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { const el = document.getElementById('invite-token-field') as HTMLInputElement | null; el?.select(); }
  };
  return <Modal title="Invitation ready to share" onClose={onClose}><div className="modal-form">
    <p className="token-lead">ClassOS has not emailed anything. Send this private token to <strong>{receipt.invitation.email}</strong> yourself. It is shown only now and expires {new Date(receipt.invitation.expiresAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} (7 days). They must sign in with that same email to use it.</p>
    <div className="token-box"><input id="invite-token-field" data-testid="text-invite-token" readOnly value={receipt.token} onFocus={e => e.currentTarget.select()} aria-label="Invitation token"/><Button type="button" onClick={copy} data-testid="button-copy-token">{copied ? <Check size={15}/> : <Copy size={15}/>}{copied ? 'Copied' : 'Copy'}</Button></div>
    <div className="modal-actions"><Button type="button" variant="outline" onClick={onClose}>I have shared it</Button></div></div></Modal>;
}

export function AcceptInviteForm({ onDone }: { onDone?: () => void }) {
  const client = useQueryClient(); const [token, setToken] = useState(''); const [ok, setOk] = useState(false);
  const accept = useAcceptInvitation();
  const submit = (e: FormEvent) => { e.preventDefault(); setOk(false); accept.mutate({ data: { token: token.trim() } }, { onSuccess: acct => {
    client.setQueryData(getGetAccountQueryKey(), acct);
    client.invalidateQueries({ predicate: q => q.queryKey[0] !== '/api/account' });
    setToken(''); setOk(true); onDone?.();
  } }); };
  return <form className="modal-form" onSubmit={submit}>
    <FormField label="Private invitation token"><input required minLength={40} maxLength={100} className={inputClass} value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the token you were sent" autoComplete="off" spellCheck={false} data-testid="input-accept-token"/></FormField>
    {accept.isError && <p className="form-error" data-testid="text-accept-error">{errMsg(accept.error, 'That token could not be accepted. Check it, or ask for a new one.')}</p>}
    {ok && <p className="form-success">Invitation accepted. Your class access is updated.</p>}
    <div><Button disabled={accept.isPending || token.trim().length < 40} data-testid="button-accept-token"><KeyRound size={15}/>{accept.isPending ? 'Checking…' : 'Accept invitation'}</Button></div></form>;
}

export default function AccessPage() {
  const { isAdmin, isStaff, isTeacher, membership } = useAccount();
  const client = useQueryClient();
  const classes = useGetClasses({ query: { queryKey: getGetClassesQueryKey() } });
  const members = useGetMembers({ query: { enabled: isAdmin, queryKey: getGetMembersQueryKey(), refetchInterval: 30000 } });
  const invitations = useGetInvitations({ query: { enabled: isStaff, queryKey: getGetInvitationsQueryKey(), refetchInterval: 30000 } });
  const create = useCreateInvitation(); const revoke = useRevokeInvitation(); const update = useUpdateMemberClasses(); const remove = useRemoveMember();
  const classList = classes.data ?? [];
  const className = (id: number) => classList.find(c => c.id === id)?.name ?? `Class ${id}`;
  const [receipt, setReceipt] = useState<InvitationReceipt | null>(null);
  const [editing, setEditing] = useState<SchoolMember | null>(null); const [editIds, setEditIds] = useState<number[]>([]);
  const [removing, setRemoving] = useState<SchoolMember | null>(null);
  const [email, setEmail] = useState(''); const [role, setRole] = useState<'teacher' | 'student'>('student'); const [ids, setIds] = useState<number[]>([]);
  const inviteSubmit = (e: FormEvent) => { e.preventDefault(); if (!ids.length) return; create.mutate({ data: { email: email.trim(), role: isAdmin ? role : 'student', classIds: ids } }, { onSuccess: r => { setReceipt(r); setEmail(''); setIds([]); client.invalidateQueries({ queryKey: getGetInvitationsQueryKey() }); } }); };
  const openEdit = (m: SchoolMember) => { setEditing(m); setEditIds(m.classIds); update.reset(); };
  const saveEdit = () => { if (!editing) return; update.mutate({ memberId: editing.id, data: { classIds: editIds } }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetMembersQueryKey() }); setEditing(null); } }); };
  const doRemove = () => { if (!removing) return; remove.mutate({ memberId: removing.id }, { onSuccess: () => { client.invalidateQueries({ queryKey: getGetMembersQueryKey() }); setRemoving(null); } }); };
  const eyebrow = isAdmin ? 'School · Access' : isTeacher ? 'Teacher · Access' : 'Your access';
  return <><PageHeading eyebrow={eyebrow} title={isAdmin ? 'Who belongs here.' : isTeacher ? 'Bring students in.' : 'Your class access.'} description={isAdmin ? 'Manage the roster, class access, and private invitations for your school.' : isTeacher ? 'Invite students to your own classes with a private token.' : 'Accept an invitation to join more classes in your school.'}/>
    <div className="access-grid">
      {isStaff && <Panel title={isAdmin ? 'Invite a teacher or student' : 'Invite a student'} subtitle="Pick the classes they will join. You will get a private token to hand over.">
        <form className="modal-form" onSubmit={inviteSubmit}>
          <FormField label="Email (must match their sign-in email)"><input required type="email" className={inputClass} value={email} onChange={e => setEmail(e.target.value)} placeholder="name@school.org" data-testid="input-invite-email"/></FormField>
          {isAdmin && <FormField label="Role"><select className={inputClass} value={role} onChange={e => setRole(e.target.value as 'teacher' | 'student')} data-testid="select-invite-role"><option value="student">Student</option><option value="teacher">Teacher</option></select></FormField>}
          <div className="form-field"><span>Classes</span>{classes.isLoading ? <Loading rows={2}/> : <ClassChecklist classes={classList} value={ids} onChange={setIds}/>}</div>
          {create.isError && <p className="form-error" data-testid="text-invite-error">{errMsg(create.error, 'Could not create this invitation.')}</p>}
          <div><Button disabled={create.isPending || !ids.length} data-testid="button-create-invite"><Mail size={15}/>{create.isPending ? 'Creating…' : 'Create invitation'}</Button></div>
        </form></Panel>}
      <Panel title="Have an invitation token?" subtitle="Add classes to your account. Invitations must match your school and role."><AcceptInviteForm/></Panel>
    </div>
    {isAdmin && <Panel title="School roster" subtitle={members.data ? `${members.data.length} people with access` : 'People with access to this school'} className="access-panel">
      {members.isLoading ? <Loading/> : members.isError ? <div className="inline-error">The roster is unavailable. <button className="text-link" onClick={() => members.refetch()}>Retry</button></div> : members.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Person</th><th>Role</th><th>Classes</th><th></th></tr></thead><tbody>{members.data.map(m => <tr key={m.id} data-testid={`row-member-${m.id}`}><td><div className="person-cell"><div className="avatar avatar-teal">{initials(m.name)}</div><div><strong>{m.name}</strong><small>{m.email}</small></div></div></td><td><span className="topic-pill role-pill">{m.role}</span></td><td>{m.role === 'admin' ? <small>School-wide</small> : m.classIds.length ? <div className="chip-row">{m.classIds.map(id => <span className="chip" key={id}>{className(id)}</span>)}</div> : <small>No classes</small>}</td><td className="row-actions">{m.role !== 'admin' && <button className="table-action" onClick={() => openEdit(m)} data-testid={`button-edit-member-${m.id}`}><Pencil size={13}/> Classes</button>}{m.id !== membership.id && <button className="table-action danger-action" onClick={() => { setRemoving(m); remove.reset(); }} data-testid={`button-remove-member-${m.id}`}><UserMinus size={13}/> Remove</button>}</td></tr>)}</tbody></table></div> : <Empty icon={Users} title="Just you so far" detail="Invite teachers and students above."/>}
    </Panel>}
    {isStaff && <Panel title="Invitations" subtitle={isAdmin ? 'Every invitation for this school' : 'Invitations you can see'} className="access-panel">
      {invitations.isLoading ? <Loading/> : invitations.isError ? <div className="inline-error">Invitations are unavailable. <button className="text-link" onClick={() => invitations.refetch()}>Retry</button></div> : invitations.data?.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Classes</th><th>Expires</th><th>Status</th><th></th></tr></thead><tbody>{invitations.data.map(inv => <tr key={inv.id} data-testid={`row-invitation-${inv.id}`}><td>{inv.email}</td><td><span className="topic-pill role-pill">{inv.role}</span></td><td><div className="chip-row">{inv.classIds.map(id => <span className="chip" key={id}>{className(id)}</span>)}</div></td><td>{new Date(inv.expiresAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td><td><span className={`status-pill status-${inv.status}`}>{inv.status}</span></td><td className="row-actions">{inv.status === 'pending' && <button className="table-action danger-action" disabled={revoke.isPending} onClick={() => revoke.mutate({ invitationId: inv.id }, { onSuccess: () => client.invalidateQueries({ queryKey: getGetInvitationsQueryKey() }) })} data-testid={`button-revoke-${inv.id}`}>Revoke</button>}</td></tr>)}</tbody></table>{revoke.isError && <p className="form-error">{errMsg(revoke.error)}</p>}</div> : <Empty icon={Mail} title="No invitations yet" detail="Tokens are only shown once, when you create an invitation."/>}
    </Panel>}
    {receipt && <TokenModal receipt={receipt} onClose={() => setReceipt(null)}/>}
    {editing && <Modal title={`Classes for ${editing.name}`} onClose={() => setEditing(null)}><div className="modal-form"><ClassChecklist classes={classList} value={editIds} onChange={setEditIds}/>{update.isError && <p className="form-error">{errMsg(update.error)}</p>}<div className="modal-actions"><Button variant="outline" type="button" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={saveEdit} disabled={update.isPending} data-testid="button-save-member-classes">{update.isPending ? 'Saving…' : 'Replace class access'}</Button></div></div></Modal>}
    {removing && <Modal title="Remove from school?" onClose={() => setRemoving(null)}><div className="modal-form"><p>{removing.name} ({removing.email}) will lose access to this school immediately.</p>{remove.isError && <p className="form-error">{errMsg(remove.error)}</p>}<div className="modal-actions"><Button variant="outline" type="button" onClick={() => setRemoving(null)}>Cancel</Button><Button onClick={doRemove} disabled={remove.isPending} data-testid="button-confirm-remove">{remove.isPending ? 'Removing…' : 'Remove access'}</Button></div></div></Modal>}
  </>;
}
