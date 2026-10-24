import { useState } from 'react';
import { BookOpen, FileText } from 'lucide-react';
import { useGetStudentNotes, getGetStudentNotesQueryKey } from '@workspace/api-client-react';
import { Empty, PageHeading, QueryState } from '@/components/kit';
import { ClassGate, ClassSelect, useActiveClass } from '@/components/student-bits';

function Notes({ classId }: { classId: number }) {
  const q = useGetStudentNotes({ classId }, { query: { queryKey: getGetStudentNotesQueryKey({ classId }) } });
  const [open, setOpen] = useState<number | null>(null);
  const list = q.data ?? [];
  const cur = list.find(n => n.id === open) ?? list[0];
  return <QueryState loading={q.isLoading} error={q.isError} onRetry={() => q.refetch()}>
    {list.length ? <div className="sx-notes">
      <nav className="sx-note-list" aria-label="Notes">{list.map(n => <button key={n.id} data-testid={`button-note-${n.id}`} className={cur?.id === n.id ? 'on' : ''} onClick={() => setOpen(n.id)}><FileText size={15}/><span><strong>{n.title}</strong><small>{n.topic}</small></span></button>)}</nav>
      {cur && <article className="panel sx-note" data-testid="text-note-body"><span className="topic-pill">{cur.topic}</span><h2>{cur.title}</h2><div className="material-source">Source: {cur.sourceName}</div><div className="sx-note-text">{cur.sourceText}</div></article>}
    </div> : <Empty icon={BookOpen} title="No notes yet" detail="Your teacher has not approved notes for this class yet."/>}
  </QueryState>;
}
export default function StudentNotes() {
  const ac = useActiveClass();
  return <><PageHeading eyebrow="Class notes" title="Read at your own pace." description="Teacher-approved notes for this class. Practice questions come from these." action={<ClassSelect ac={ac}/>}/>
    <ClassGate ac={ac}>{id => <Notes key={`${ac.scope}:${id}`} classId={id}/>}</ClassGate></>;
}
