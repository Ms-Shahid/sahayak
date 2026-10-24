import { Trophy } from 'lucide-react';
import { useGetStudentOverview, getGetStudentOverviewQueryKey } from '@workspace/api-client-react';
import { Empty, PageHeading, Panel, QueryState } from '@/components/kit';
import { ClassGate, ClassSelect, PointsRules, useActiveClass } from '@/components/student-bits';

function Progress({ classId }: { classId: number }) {
  const ov = useGetStudentOverview({ classId }, { query: { queryKey: getGetStudentOverviewQueryKey({ classId }), refetchInterval: 30000 } });
  const o = ov.data;
  return <QueryState loading={ov.isLoading} error={ov.isError} onRetry={() => ov.refetch()}>{o && <>
    <div className="metric-grid">{[['Total XP', o.xpTotal], ['Level', o.level], ['Class rank', o.myRank > 0 ? `#${o.myRank}` : 'None yet'], ['XP to next level', o.xpToNextLevel]].map(m => <div className="metric-card sx-metric" key={String(m[0])}><div className="metric-label">{m[0]}</div><div className="metric-value">{m[1]}</div></div>)}</div>
    <div className="sx-grid">
      <Panel title="Your scorecard" subtitle="Where your XP came from">
        <div className="sx-score">{([['Attendance', o.xpBreakdown.attendance, `${o.counts.classesAttended} days attended`], ['Practice', o.xpBreakdown.practice, `${o.counts.practiceCompleted} sessions finished`], ['Puzzle quests', o.xpBreakdown.quiz, `${o.counts.quizzesSubmitted} quests submitted`], ['Assignments', o.xpBreakdown.assignment, `${o.counts.assignmentsCompleted} submitted`]] as const).map(r => <div key={r[0]}><span>{r[0]}<small>{r[2]}</small></span><strong>{r[1]} XP</strong></div>)}</div>
      </Panel>
      <Panel title="How XP works"><PointsRules/></Panel>
    </div>
    <Panel title="Class leaderboard" subtitle="Anonymous aliases, this class only">
      {o.leaderboard.length ? <ol className="sx-board">{o.leaderboard.map(e => <li key={e.alias} className={e.isMe ? 'me' : ''} data-testid={`row-rank-${e.rank}`}><b>{e.rank}</b><span>{e.alias}{e.isMe && ' (you)'}</span><strong>{e.xp} XP</strong></li>)}</ol> : <Empty icon={Trophy} title="No XP on the board yet" detail="Attend class, practice, or submit an assignment to appear."/>}
    </Panel>
  </>}</QueryState>;
}
export default function StudentProgress() {
  const ac = useActiveClass();
  return <><PageHeading eyebrow="My progress" title="Your growth, your scorecard." description="Progress is measured by what you learn, never by how fast." action={<ClassSelect ac={ac}/>}/>
    <ClassGate ac={ac}>{id => <Progress key={`${ac.scope}:${id}`} classId={id}/>}</ClassGate></>;
}
