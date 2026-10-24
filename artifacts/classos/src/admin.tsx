import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAccessPolicyQueryKey, getGetAdminMaterialsQueryKey, getGetAdminUsersQueryKey,
  getGetAuditLogQueryKey, getGetClassMembersQueryKey, useCreateAdminUser, useGetAccessPolicy,
  useGetAdminMaterials, useGetAdminUsers, useGetAuditLog, useGetClasses, useGetClassMembers,
  useSetClassMember, useUpdateAccessPolicy, useUpdateAdminUserRole, useUpdateMaterial,
} from '@workspace/api-client-react';
import type { AppUser } from '@workspace/api-client-react';
import { Button, FormField, PageHeading, Panel, QueryState } from './App';

const tabs = ['Users', 'Class access', 'Content policy', 'Content governance', 'Audit log'] as const;
type Tab = (typeof tabs)[number];
const visibilityLabel: Record<string, string> = { teachers: 'Teachers only', students: 'Students and AI', ai_only: 'AI only (hidden from students)' };

function UsersTab() {
  const client = useQueryClient();
  const users = useGetAdminUsers();
  const create = useCreateAdminUser();
  const setRole = useUpdateAdminUserRole();
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [role, setRoleState] = useState<AppUser['role']>('teacher');
  const refresh = () => client.invalidateQueries({ queryKey: getGetAdminUsersQueryKey() });
  const add = (e: FormEvent) => { e.preventDefault(); create.mutate({ data: { name, email, role } }, { onSuccess: () => { setName(''); setEmail(''); refresh(); } }); };
  return <><Panel title="Add a user" subtitle="Demo accounts have no password; they appear on the sign-in screen.">
    <form className="form-two" onSubmit={add}>
      <FormField label="Name"><input required className="field" value={name} onChange={e => setName(e.target.value)}/></FormField>
      <FormField label="Email"><input required type="email" className="field" value={email} onChange={e => setEmail(e.target.value)}/></FormField>
      <FormField label="Role"><select className="field" value={role} onChange={e => setRoleState(e.target.value as AppUser['role'])}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></FormField>
      <div style={{ alignSelf: 'end' }}><Button disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add user'}</Button></div>
    </form>
    {create.isError && <p className="form-error">Could not add this user. The email may already exist.</p>}
  </Panel>
  <Panel title="Users" subtitle="Change a role to change what the person can do."><QueryState loading={users.isLoading} error={users.isError} onRetry={() => users.refetch()}>
    <div className="admin-scroll"><table className="admin-table"><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>
      {users.data?.map(u => <tr key={u.id}><td>{u.name}</td><td>{u.email}</td><td><select aria-label={`Role for ${u.name}`} value={u.role} onChange={e => setRole.mutate({ userId: u.id, data: { role: e.target.value as AppUser['role'] } }, { onSuccess: refresh })}><option value="admin">Admin</option><option value="teacher">Teacher</option><option value="student">Student</option></select></td></tr>)}
    </tbody></table></div>
    {setRole.isError && <p className="form-error">That role change was not allowed.</p>}
  </QueryState></Panel></>;
}

function ClassAccessTab() {
  const client = useQueryClient();
  const classes = useGetClasses(); const users = useGetAdminUsers(); const members = useGetClassMembers();
  const toggle = useSetClassMember();
  const has = (userId: number, classId: number) => members.data?.some(m => m.userId === userId && m.classId === classId) ?? false;
  const people = (users.data ?? []).filter(u => u.role !== 'admin');
  return <Panel title="Class access" subtitle="Teachers see and manage only the classes they are assigned. Students see only the classes they are enrolled in. Admins reach every class."><QueryState loading={classes.isLoading || users.isLoading || members.isLoading} error={classes.isError || users.isError || members.isError}>
    <div className="member-grid">{classes.data?.map(room => <div className="member-class" key={room.id}><h3>{room.name}</h3>
      {(['teacher', 'student'] as const).map(r => <div key={r} style={{ marginBottom: 8 }}><small>{r === 'teacher' ? 'Teachers' : 'Students'}</small><div className="member-chips">{people.filter(u => u.role === r).map(u => { const on = has(u.id, room.id); return <button key={u.id} className={`chip-toggle ${on ? 'chip-on' : ''}`} aria-pressed={on} onClick={() => toggle.mutate({ data: { userId: u.id, classId: room.id, member: !on } }, { onSuccess: () => client.invalidateQueries({ queryKey: getGetClassMembersQueryKey() }) })}>{u.name}</button>; })}</div></div>)}
    </div>)}</div>
  </QueryState></Panel>;
}

function PolicyTab() {
  const client = useQueryClient();
  const policy = useGetAccessPolicy(); const update = useUpdateAccessPolicy();
  const save = (patch: Partial<NonNullable<typeof policy.data>>) => policy.data && update.mutate({ data: { ...policy.data, ...patch } }, { onSuccess: () => client.invalidateQueries({ queryKey: getGetAccessPolicyQueryKey() }) });
  return <Panel title="Content policy" subtitle="Defaults applied when content is uploaded."><QueryState loading={policy.isLoading} error={policy.isError}>{policy.data && <div className="modal-form">
    <FormField label="School-level (Tier 1) uploads are visible to"><select className="field" value={policy.data.tier1DefaultVisibility} onChange={e => save({ tier1DefaultVisibility: e.target.value as any })}><option value="ai_only">AI only: grounds the tutor but students cannot open it</option><option value="students">Students and AI</option><option value="teachers">Teachers only</option></select></FormField>
    <FormField label="Teacher uploads to a class start as"><select className="field" value={policy.data.classUploadDefaultStatus} onChange={e => save({ classUploadDefaultStatus: e.target.value as any })}><option value="published">Published immediately</option><option value="draft">Draft until a teacher or admin publishes</option></select></FormField>
    <small className="field-help">Existing content keeps its current setting; change it under Content governance.</small>
  </div>}</QueryState></Panel>;
}

function GovernanceTab() {
  const client = useQueryClient();
  const materials = useGetAdminMaterials(); const update = useUpdateMaterial(); const classes = useGetClasses();
  const className = (id: number | null) => classes.data?.find(c => c.id === id)?.name ?? '—';
  const change = (materialId: number, data: { visibility?: any; status?: any }) => update.mutate({ materialId, data }, { onSuccess: () => client.invalidateQueries({ queryKey: getGetAdminMaterialsQueryKey() }) });
  return <Panel title="Content governance" subtitle="Control who can open each source and whether the AI may use it."><QueryState loading={materials.isLoading} error={materials.isError} onRetry={() => materials.refetch()}>
    <div className="admin-scroll"><table className="admin-table"><thead><tr><th>Source</th><th>Level</th><th>Applies to</th><th>Visibility</th><th>Status</th></tr></thead><tbody>
      {materials.data?.map(m => <tr key={m.id}><td><strong>{m.title}</strong><br/><small>{m.topic}</small></td><td><span className={`badge ${m.scope === 'school' ? '' : 'badge-muted'}`}>{m.scope === 'school' ? 'School (Tier 1)' : 'Class (Tier 2)'}</span></td><td>{m.scope === 'school' ? [m.grade ?? 'All grades', m.subject ?? 'all subjects'].join(' · ') : className(m.classId)}</td>
        <td><select aria-label={`Visibility for ${m.title}`} value={m.visibility} onChange={e => change(m.id, { visibility: e.target.value })}>{Object.entries(visibilityLabel).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></td>
        <td><select aria-label={`Status for ${m.title}`} value={m.status} onChange={e => change(m.id, { status: e.target.value })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></td></tr>)}
    </tbody></table></div>
  </QueryState></Panel>;
}

function AuditTab() {
  const audit = useGetAuditLog({ query: { queryKey: getGetAuditLogQueryKey(), refetchOnMount: 'always' } as any });
  return <Panel title="Audit log" subtitle="The 100 most recent access and content changes."><QueryState loading={audit.isLoading} error={audit.isError} onRetry={() => audit.refetch()}>
    <div className="admin-scroll"><table className="admin-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>
      {audit.data?.map(a => <tr key={a.id}><td>{new Date(a.createdAt).toLocaleString()}</td><td>{a.actorName}</td><td><span className="badge">{a.action.replaceAll('_', ' ')}</span></td><td>{a.detail}</td></tr>)}
    </tbody></table></div>
  </QueryState></Panel>;
}

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Users');
  return <><PageHeading eyebrow="Admin · Access control" title="Decide who sees what." description="Manage users, class access and how uploaded content is made available to teachers, students and the AI tutor."/>
    <div className="admin-tabs" role="tablist">{tabs.map(t => <button key={t} role="tab" aria-selected={tab === t} className={`admin-tab ${tab === t ? 'admin-tab-active' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>
    {tab === 'Users' && <UsersTab/>}{tab === 'Class access' && <ClassAccessTab/>}{tab === 'Content policy' && <PolicyTab/>}{tab === 'Content governance' && <GovernanceTab/>}{tab === 'Audit log' && <AuditTab/>}</>;
}
