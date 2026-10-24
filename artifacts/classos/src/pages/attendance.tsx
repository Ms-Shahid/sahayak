import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { useGetClassAttendance, getGetClassAttendanceQueryKey, useRecordClassAttendance } from '@workspace/api-client-react';
import { Empty, PageHeading, Panel, QueryState, errMsg } from '@/components/kit';
import { ClassGate, ClassSelect, useActiveClass } from '@/components/student-bits';

const today = () => new Date().toISOString().slice(0, 10);

function Sheet({ classId }: { classId: number }) {
  const qc = useQueryClient(); const [date, setDate] = useState(today()); const [err, setErr] = useState('');
  const params = { classId, date }; const key = getGetClassAttendanceQueryKey(params);
  const q = useGetClassAttendance(params, { query: { queryKey: key, refetchInterval: query => (query.state.dataUpdateCount < 12 ? 20000 : false) } });
  const rec = useRecordClassAttendance();
  const mark = async (memberId: number, present: boolean) => {
    setErr('');
    try { await rec.mutateAsync({ data: { classId, date, memberId, present } }); await qc.invalidateQueries({ queryKey: key }); } catch (e) { setErr(errMsg(e)); }
  };
  const list = q.data ?? [];
  return <Panel title="Attendance sheet" subtitle="Each present calendar day (UTC) awards the student 10 XP" action={<input type="date" aria-label="Attendance date (UTC)" className="field" style={{ width: 160 }} data-testid="input-date" value={date} max={today()} onChange={e => e.target.value && e.target.value <= today() && setDate(e.target.value)}/>}>
    {err && <p className="form-error">{err}</p>}
    <QueryState loading={q.isLoading} error={q.isError} onRetry={() => q.refetch()}>
      {list.length ? <div className="sx-att">{list.map(s => <div key={s.memberId} data-testid={`row-student-${s.memberId}`}><strong>{s.name}</strong><div className="sx-seg"><button disabled={rec.isPending} className={s.present ? 'on' : ''} onClick={() => !s.present && mark(s.memberId, true)}>Present</button><button disabled={rec.isPending} className={!s.present ? 'off' : ''} onClick={() => s.present && mark(s.memberId, false)}>Absent</button></div></div>)}</div> : <Empty icon={Users} title="No students in this class" detail="Invite students from Access & invitations."/>}
    </QueryState></Panel>;
}
export default function Attendance() {
  const ac = useActiveClass();
  return <><PageHeading eyebrow="Teacher · Attendance" title="Mark who was here." description="Attendance is recorded by you and earns students XP. Future dates are not allowed." action={<ClassSelect ac={ac}/>}/>
    <ClassGate ac={ac}>{id => <Sheet key={`${ac.scope}:${id}`} classId={id}/>}</ClassGate></>;
}
