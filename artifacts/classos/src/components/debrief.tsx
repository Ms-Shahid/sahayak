import { useGetLearningDebrief, getGetLearningDebriefQueryKey } from '@workspace/api-client-react';
import { Lightbulb, RefreshCw } from 'lucide-react';
import { Link } from 'wouter';
import { useAccount } from '@/lib/account';
import { Empty, Loading, Panel } from '@/components/kit';
import { QuestionResultList } from '@/components/files';

export function LearningDebrief({ classId }: { classId: number }) {
  const { isStaff } = useAccount();
  const q = useGetLearningDebrief({ classId }, { query: { enabled: isStaff && classId > 0, queryKey: getGetLearningDebriefQueryKey({ classId }), refetchInterval: 15000 } });
  if (!isStaff) return null;
  const d = q.data;
  return <Panel title="Learning debrief" subtitle="Topic evidence from scored and teacher-reviewed work" className="debrief-panel" action={<button className="table-action" onClick={() => q.refetch()} disabled={q.isFetching}><RefreshCw size={12}/> {q.isFetching ? 'Updating' : 'Refresh'}</button>}>
    {q.isLoading ? <Loading rows={3}/> : q.isError || !d ? <div className="inline-error">The debrief is unavailable. <button className="table-action" onClick={() => q.refetch()}>Retry</button></div> : <>
      <div className="debrief-meta"><span><strong>{d.reviewedCount}</strong> reviewed</span><span><strong>{d.pendingCount}</strong> awaiting review</span></div>
      <p className="debrief-notice" data-testid="text-debrief-notice">{d.notice}</p>
      <p className="field-help">Topic evidence comes from automatic question marks or teacher rubric marks, which replace automatic marks after review. Overall-score-only file grades and pending work are left out. Limited evidence is a prompt to review more, not a verdict. Student practice uses per-topic rubric results and the latest scored work.</p>
      {d.topics.length ? <div className="debrief-topics">{d.topics.map(t => <details className="debrief-topic" key={t.topic} data-testid={`card-debrief-${t.topic}`}>
        <summary><span className="topic-pill">{t.topic}</span><div className="progress-track"><div className="progress-fill debrief-fill" style={{ width: `${Math.max(0, Math.min(100, t.score))}%` }}/></div><strong>{Math.round(t.score)}%</strong><small>{t.studentsNeedingSupport} need support · {t.evidenceCount} {t.evidenceCount === 1 ? 'piece' : 'pieces'} of evidence</small></summary>
        {t.evidenceCount < 3 && <p className="rubric-warn">Limited evidence: only {t.evidenceCount} scored {t.evidenceCount === 1 ? 'answer' : 'answers'}. Treat this as a hint.</p>}
        <div className="warmup"><Lightbulb size={15}/><div><span className="label-caps">NEXT LESSON WARM-UP</span><p>{t.warmUp}</p></div></div>
        {!t.sourceAvailable && <p className="qr-nosource">Source unavailable for this topic; check the class sources before teaching it.</p>}
        {t.evidence.length ? <div className="debrief-evidence">{t.evidence.map(e => <div key={`${e.submissionId}-${e.result.questionId}`}><small className="qr-pick">{e.studentName} · submission #{e.submissionId} · <Link href={`/assignments?classId=${classId}&assignmentId=${e.assignmentId}`}>Open submitted work</Link></small><QuestionResultList results={[e.result]}/></div>)}</div> : <p className="subtle-empty">No linked work for this topic yet.</p>}
      </details>)}</div> : <Empty title="Insufficient evidence" detail="No question-level marks yet. Collect submitted answers or review work by question to surface topic evidence."/>}
    </>}
  </Panel>;
}
