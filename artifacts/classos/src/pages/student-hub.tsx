import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BookOpen, Puzzle, Sparkles, Trophy } from 'lucide-react';
import { useGetStudentOverview, getGetStudentOverviewQueryKey, useSaveLearningPace } from '@workspace/api-client-react';
import type { StudentOverviewPace } from '@workspace/api-client-react';
import { Button, PageHeading, Panel, QueryState, errMsg } from '@/components/kit';
import { ClassGate, ClassSelect, PointsRules, paceInfo, useActiveClass } from '@/components/student-bits';
import { useAccount } from '@/lib/account';

const stageLabel: Record<string, string> = { start: 'Start here', revisit: 'Revisit', build: 'Build', extend: 'Extend' };

function Hub({ classId }: { classId: number }) {
  const qc = useQueryClient(); const [, nav] = useLocation();
  const key = getGetStudentOverviewQueryKey({ classId });
  const ov = useGetStudentOverview({ classId }, { query: { queryKey: key, refetchInterval: 30000 } });
  const save = useSaveLearningPace(); const [err, setErr] = useState('');
  const setPace = async (pace: StudentOverviewPace) => {
    setErr('');
    try { await save.mutateAsync({ data: { classId, pace } }); await qc.invalidateQueries({ queryKey: key }); } catch (e) { setErr(errMsg(e)); }
  };
  const o = ov.data;
  const total = o ? o.xpTotal + o.xpToNextLevel : 0;
  const pct = o && total > 0 ? Math.min(100, (o.xpTotal / total) * 100) : 0;
  return <QueryState loading={ov.isLoading} error={ov.isError} onRetry={() => ov.refetch()}>{o && <>
    <div className="sx-hero">
      <div><span className="banner-kicker">LEVEL {o.level}</span><h2 data-testid="text-xp-total">{o.xpTotal} XP</h2><p>{o.xpToNextLevel} XP to level {o.level + 1}. Every step counts, at your own pace.</p>
        <div className="sx-bar"><i style={{ width: `${pct}%` }}/></div></div>
      <div className="sx-hero-actions">
        {o.activeSessionId ? <Button data-testid="button-resume" onClick={() => nav(`/student/play?session=${o.activeSessionId}`)}>Resume where you left off <ArrowRight size={15}/></Button> : <Button data-testid="button-start-puzzle" onClick={() => nav('/student/play?mode=puzzle')}><Puzzle size={15}/> Start a puzzle quest</Button>}
        <Link href="/student/progress" className="banner-link"><Trophy size={14}/> Rank {o.myRank > 0 ? `#${o.myRank}` : 'not yet ranked'}</Link>
      </div>
    </div>
    <div className="sx-grid">
      <Panel title="Your pace" subtitle="Applies to every new session you start">
        <div className="sx-pace" role="radiogroup">{(['relaxed', 'steady', 'challenge'] as const).map(p => <button key={p} role="radio" aria-checked={o.pace === p} data-testid={`button-pace-${p}`} disabled={save.isPending} className={o.pace === p ? 'on' : ''} onClick={() => setPace(p)}><strong>{paceInfo[p].label}</strong><span>{paceInfo[p].text}</span></button>)}</div>
        {err && <p className="form-error">{err}</p>}
      </Panel>
      <Panel title="How XP works"><PointsRules/></Panel>
    </div>
    <Panel title="Suggested next steps" subtitle="Based on your own results in this class">
      {o.topics.length ? <div className="sx-topics">{o.topics.map(t => <div className="sx-topic" key={t.topic} data-testid={`card-topic-${t.topic}`}>
        <div><span className="topic-pill">{stageLabel[t.stage] ?? t.stage}</span><h3>{t.topic}</h3><p>{t.reason}</p>
          <div className="progress-track"><div className="progress-fill" style={{ width: `${t.mastery ?? 0}%` }}/></div>
          <small>{t.mastery === null ? 'No mastery yet' : `${Math.round(t.mastery)}% mastery`} · {t.attempts} attempts · {t.suggestedQuestions} suggested questions</small></div>
        <div className="sx-topic-actions"><Button variant="outline" onClick={() => nav(`/student/play?mode=practice&topic=${encodeURIComponent(t.topic)}`)}><Sparkles size={14}/> Practice</Button><Button variant="outline" onClick={() => nav(`/student/play?mode=puzzle&topic=${encodeURIComponent(t.topic)}`)}><Puzzle size={14}/> Puzzle</Button></div>
      </div>)}</div> : <p className="field-help">Topics appear once your teacher publishes questions for this class.</p>}
    </Panel>
    <div className="sx-links"><Link href="/student/notes" className="button button-outline"><BookOpen size={15}/> Read class notes</Link><Link href="/assignments" className="button button-outline">Open assignments</Link></div>
  </>}</QueryState>;
}
export default function StudentHub() {
  const { account } = useAccount(); const ac = useActiveClass();
  return <><PageHeading eyebrow="Learning hub" title={`Welcome, ${account.name.split(' ')[0] || 'learner'}.`} description="Learn at the pace that suits you. There are no timers here." action={<ClassSelect ac={ac}/>}/>
    <ClassGate ac={ac}>{id => <Hub key={`${ac.scope}:${id}`} classId={id}/>}</ClassGate></>;
}
