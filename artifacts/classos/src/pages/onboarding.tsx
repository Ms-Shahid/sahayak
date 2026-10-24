import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useClerk } from '@clerk/react';
import { BookOpen, LogOut, School } from 'lucide-react';
import { useEnrollSchool, getGetAccountQueryKey } from '@workspace/api-client-react';
import type { Account } from '@workspace/api-client-react';
import { Button, FormField, errMsg, inputClass } from '@/components/kit';
import { AcceptInviteForm } from '@/pages/access';

export default function Onboarding({ account }: { account: Account }) {
  const client = useQueryClient(); const { signOut } = useClerk();
  const [schoolName, setSchoolName] = useState('');
  const enroll = useEnrollSchool();
  const create = (e: FormEvent) => { e.preventDefault(); enroll.mutate({ data: { schoolName: schoolName.trim() } }, { onSuccess: acct => client.setQueryData(getGetAccountQueryKey(), acct) }); };
  return <div className="onboard-page">
    <header className="onboard-top"><div className="brand-mark"><BookOpen size={20}/></div><strong>ClassOS</strong><span className="onboard-who">{account.name} · {account.email}</span><button className="table-action" onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, '') || '/' })}><LogOut size={14}/> Sign out</button></header>
    <div className="onboard-body">
      <div className="eyebrow">ONE LAST STEP</div><h1>Connect your account to a school.</h1>
      <p className="onboard-lead">ClassOS accounts belong to a school. Start a new school as its administrator, or join one with a private invitation token from your school.</p>
      <div className="onboard-grid">
        <section className="panel onboard-card"><div className="empty-icon"><School size={22}/></div><h2>Start a new school</h2><p>You become the initial administrator and can invite teachers and students.</p>
          <form className="modal-form" onSubmit={create}><FormField label="School name"><input required minLength={2} maxLength={120} className={inputClass} value={schoolName} onChange={e => setSchoolName(e.target.value)} placeholder="Your school's name" data-testid="input-school-name"/></FormField>
            {enroll.isError && <p className="form-error" data-testid="text-enroll-error">{errMsg(enroll.error, 'Could not create the school.')}</p>}
            <div><Button disabled={enroll.isPending || schoolName.trim().length < 2} data-testid="button-create-school">{enroll.isPending ? 'Creating…' : 'Create school'}</Button></div></form></section>
        <section className="panel onboard-card"><div className="empty-icon"><BookOpen size={22}/></div><h2>I have an invitation</h2><p>Sign in with the email your school invited, then paste the private token they gave you.</p><AcceptInviteForm/></section>
      </div></div></div>;
}
