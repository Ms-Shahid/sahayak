import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Users } from 'lucide-react';
import { useGetClasses, getGetClassesQueryKey } from '@workspace/api-client-react';
import { ACTIVE_CLASS_KEY, useAccount } from '@/lib/account';
import { Empty, QueryState } from '@/components/kit';

export function useActiveClass() {
  const { scope } = useAccount();
  const key = `${ACTIVE_CLASS_KEY}:${scope}`;
  const classes = useGetClasses({ query: { queryKey: getGetClassesQueryKey(), refetchInterval: 30000 } });
  const [saved, setSaved] = useState<number>(() => Number(window.sessionStorage.getItem(key)) || 0);
  useEffect(() => { setSaved(Number(window.sessionStorage.getItem(key)) || 0); }, [key]);
  const list = classes.data ?? [];
  const classId = list.some(c => c.id === saved) ? saved : list[0]?.id ?? 0;
  const setClassId = (id: number) => { window.sessionStorage.setItem(key, String(id)); setSaved(id); };
  return { classes, list, classId, setClassId, scope };
}
export type ActiveClass = ReturnType<typeof useActiveClass>;

export function ClassSelect({ ac }: { ac: ActiveClass }) {
  return <label className="class-picker"><span>CLASS SPACE</span><select data-testid="select-class" value={ac.classId} onChange={e => ac.setClassId(Number(e.target.value))} aria-label="Choose class">{ac.list.map(c => <option key={c.id} value={c.id}>{c.name} · Grade {c.grade}</option>)}</select><ChevronDown size={15}/></label>;
}

export function ClassGate({ ac, children }: { ac: ActiveClass; children: (classId: number) => ReactNode }) {
  return <QueryState loading={ac.classes.isLoading} error={ac.classes.isError} onRetry={() => ac.classes.refetch()}>
    {ac.classId > 0 ? <>{children(ac.classId)}</> : <Empty icon={Users} title="No class space yet" detail="Once your school adds you to a class, your notes, practice and progress will appear here."/>}
  </QueryState>;
}

export function PointsRules() {
  const rules = [['10', 'per day', 'Attendance recorded by your teacher'], ['25', 'once', 'Each assignment you submit'], ['5', 'per question', 'Published practice question completed, first time only'], ['10', 'per question', 'Published puzzle question submitted, first time only']];
  return <div className="sx-rules" data-testid="panel-points-rules">{rules.map(r => <div key={r[2]}><strong>{r[0]}<small> XP</small></strong><span>{r[1]}</span><p>{r[2]}</p></div>)}<p className="sx-rules-note">XP rewards participation, not grades or speed. Replaying a question never earns XP twice in the same mode. Take the time you need.</p></div>;
}

export const paceInfo: Record<string, { label: string; text: string }> = {
  relaxed: { label: 'Relaxed', text: 'Smaller steps, more review, gentle questions.' },
  steady: { label: 'Steady', text: 'A balanced mix of review and new ideas.' },
  challenge: { label: 'Challenge', text: 'Fewer reminders, stretching questions.' },
};
