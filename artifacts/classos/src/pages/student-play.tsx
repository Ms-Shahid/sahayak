import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearch } from 'wouter';
import { ArrowLeft, ArrowRight, Check, Lightbulb, Puzzle, RotateCcw, Sparkles } from 'lucide-react';
import { useGetStudentOverview, getGetStudentOverviewQueryKey, useGetStudentSession, getGetStudentSessionQueryKey, useStartStudentSession, useSubmitStudentSession } from '@workspace/api-client-react';
import type { StudentSession } from '@workspace/api-client-react';
import { Button, Loading, PageHeading, errMsg } from '@/components/kit';
import { ClassGate, ClassSelect, PointsRules, paceInfo, useActiveClass } from '@/components/student-bits';

const L = 'ABCD';
function Play({ classId, scope, setClassId }: { classId: number; scope: string; setClassId: (id: number) => void }) {
  const qc = useQueryClient(); const [, nav] = useLocation(); const sp = new URLSearchParams(useSearch());
  const ovKey = getGetStudentOverviewQueryKey({ classId });
  const ov = useGetStudentOverview({ classId }, { query: { queryKey: ovKey } });
  const urlSession = Number(sp.get('session')) || 0;
  const sid = urlSession;
  const skey = sid ? getGetStudentSessionQueryKey(sid) : getGetStudentSessionQueryKey(0);
  const q = useGetStudentSession(sid, { query: { queryKey: skey, enabled: sid > 0, refetchInterval: query => (!query.state.data?.submitted && query.state.dataUpdateCount < 6 ? 15000 : false) } });
  const session: StudentSession | undefined = sid > 0 ? q.data : undefined;
  const [mode, setMode] = useState<'practice' | 'puzzle'>(sp.get('mode') === 'practice' ? 'practice' : 'puzzle');
  const [topic, setTopic] = useState(sp.get('topic') ?? '');
  const [err, setErr] = useState(''); const [idx, setIdx] = useState(0); const [hint, setHint] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [review, setReview] = useState(false);
  const start = useStartStudentSession(); const submit = useSubmitStudentSession();
  const storeKey = session ? `classos-sel:${scope}:${classId}:${session.id}` : '';
  const sessionId = session?.id; const nq = session?.questions.length ?? 0; const done = session?.submitted;
  useEffect(() => {
    if (!sessionId) return;
    setIdx(0); setHint(false); setReview(false);
    let saved: number[] = [];
    try { saved = JSON.parse(window.localStorage.getItem(storeKey) || '[]'); } catch { /* ignore */ }
    setAnswers(Array.from({ length: nq }, (_, i) => (Number.isInteger(saved[i]) ? saved[i] : -1)));
  }, [sessionId, nq, storeKey]);
  const pick = (qi: number, oi: number) => setAnswers(a => { const n = [...a]; n[qi] = oi; if (storeKey) try { window.localStorage.setItem(storeKey, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const begin = async (m = mode, t = topic) => {
    setErr('');
    try {
      const s = await start.mutateAsync({ data: { classId, mode: m, ...(t.trim() ? { topic: t.trim() } : {}) } });
      qc.setQueryData(getGetStudentSessionQueryKey(s.id), s); setMode(s.mode); nav(`/student/play?session=${s.id}`);
      qc.invalidateQueries({ queryKey: ovKey });
    } catch (e) { setErr(errMsg(e, 'We could not start a session. Check that this class has approved notes.')); }
  };
  const finish = async () => {
    if (!session) return; setErr('');
    try {
      const s = await submit.mutateAsync({ sessionId: session.id, data: { answers } });
      qc.setQueryData(getGetStudentSessionQueryKey(s.id), s);
      if (storeKey) try { window.localStorage.removeItem(storeKey); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ovKey });
    } catch (e) { setErr(errMsg(e)); }
  };
  const leave = () => nav('/student/play');
  const fb = useMemo(() => new Map((session?.feedback ?? []).map(f => [f.questionId, f])), [session]);

  if (sid && !session) {
    if (q.isError) return <div className="state-card" data-testid="state-session-error"><h3>We could not open this session</h3><p>It may not exist or may belong to someone else. Your other work is safe.</p><div className="sx-actions" style={{ justifyContent: 'center' }}><Button variant="outline" onClick={() => q.refetch()}>Try again</Button><Button data-testid="button-start-over" onClick={leave}>Start over</Button><Button variant="outline" onClick={() => nav('/student')}>Back to learning</Button></div></div>;
    return <Loading/>;
  }
  if (session && session.classId !== classId) {
    return <div className="state-card" data-testid="state-wrong-class"><h3>This session belongs to a different class</h3><p>Switch back to that class to continue it, or start something new in this one.</p><div className="sx-actions" style={{ justifyContent: 'center' }}><Button onClick={() => setClassId(session.classId)}>Switch to that class</Button><Button variant="outline" data-testid="button-start-over" onClick={leave}>Start over here</Button></div></div>;
  }
  if (!session) {
    return <div className="sx-start">
      <div className="panel">{ov.data?.activeSessionId ? <div className="sx-hint" data-testid="panel-resume"><span>You have an unfinished session.</span><button className="table-action" style={{ marginTop: 0 }} onClick={() => nav(`/student/play?session=${ov.data!.activeSessionId}`)}>Resume it</button></div> : null}<h2 className="sx-h">Choose how to play</h2>
        <div className="sx-modes">{([['puzzle', 'Puzzle quest', 'Match the right answer tile into each puzzle slot.', Puzzle], ['practice', 'Practice', 'One question at a time with hints.', Sparkles]] as const).map(m => { const Icon = m[3]; return <button key={m[0]} data-testid={`button-mode-${m[0]}`} className={mode === m[0] ? 'on' : ''} onClick={() => setMode(m[0])}><Icon size={20}/><strong>{m[1]}</strong><span>{m[2]}</span></button>; })}</div>
        <label className="form-field"><span>Topic (optional)</span>
          <select className="field" data-testid="select-topic" value={topic} onChange={e => setTopic(e.target.value)}><option value="">Suggested for me</option>{ov.data?.topics.map(t => <option key={t.topic} value={t.topic}>{t.topic}</option>)}{topic && !ov.data?.topics.some(t => t.topic === topic) && <option value={topic}>{topic}</option>}</select></label>
        <p className="field-help">Your pace: <strong>{ov.data ? paceInfo[ov.data.pace].label : '...'}</strong>. {ov.data && paceInfo[ov.data.pace].text} Change it on the learning hub. No timers.</p>
        {err && <p className="form-error">{err}</p>}
        <Button data-testid="button-begin" disabled={start.isPending} onClick={() => begin()}>{start.isPending ? 'Preparing...' : 'Begin'}</Button></div>
      <div className="panel"><h2 className="sx-h">How XP works</h2><PointsRules/></div></div>;
  }
  const qs = session.questions;
  if (done && !review) {
    const correct = session.feedback.filter(f => f.correct).length;
    return <div className="panel sx-done" data-testid="panel-complete"><span className="banner-kicker">SESSION COMPLETE</span>
      <h2>{correct} of {qs.length} correct</h2><p>Score <strong data-testid="text-score">{session.score ?? correct}%</strong> · <strong data-testid="text-xp-earned">+{session.xpEarned} XP</strong>{session.xpEarned === 0 && '. You already earned XP for these questions in this mode.'}</p>
      <div className="sx-actions"><Button data-testid="button-review" onClick={() => { setReview(true); setIdx(0); }}>Review answers</Button><Button variant="outline" data-testid="button-restart" disabled={start.isPending} onClick={() => begin(session.mode, session.topic)}><RotateCcw size={14}/> Start a new one</Button><Button variant="outline" onClick={() => nav('/student/progress')}>See progress</Button><Button variant="outline" onClick={leave}>Done</Button></div>{err && <p className="form-error">{err}</p>}</div>;
  }
  const cur = qs[idx]; const f = cur ? fb.get(cur.id) : undefined; const sel = answers[idx] ?? -1;
  const allIn = answers.length === nq && answers.every(a => a >= 0);
  return <div className="sx-play">
    <div className="sx-top"><button className="table-action" data-testid="button-pause" onClick={() => nav('/student')}><ArrowLeft size={14}/> Pause and go back</button><span className="topic-pill">{session.mode === 'puzzle' ? 'Puzzle quest' : 'Practice'} · {session.topic || 'Mixed topics'} · {paceInfo[session.pace].label}</span></div>
    <div className={session.mode === 'puzzle' ? 'sx-board-slots' : 'sx-steps'}>{qs.map((x, i) => { const r = fb.get(x.id); return <button key={x.id} data-testid={`button-slot-${i}`} aria-label={`Question ${i + 1}`} className={`${i === idx ? 'cur' : ''} ${(answers[i] ?? -1) >= 0 || r ? 'fill' : ''} ${r ? (r.correct ? 'ok' : 'miss') : ''}`} onClick={() => { setIdx(i); setHint(false); }}>{session.mode === 'puzzle' ? ((answers[i] ?? -1) >= 0 ? L[answers[i]] : i + 1) : i + 1}</button>; })}</div>
    {cur && <div className="panel sx-q"><span className="label-caps">QUESTION {idx + 1} OF {nq} · {cur.topic}</span><h2>{cur.prompt}</h2>
      <div className={`sx-tiles ${session.mode}`}>{cur.options.map((o, i) => { const st = f ? (i === f.answerIndex ? 'ok' : i === f.selectedIndex ? 'miss' : '') : ''; return <button key={i} data-testid={`tile-${idx}-${i}`} disabled={!!done} aria-pressed={sel === i} className={`sx-tile ${sel === i || f?.selectedIndex === i ? 'sel' : ''} ${st}`} onClick={() => pick(idx, i)}><b>{L[i]}</b><span>{o}</span>{st === 'ok' && <Check size={15}/>}</button>; })}</div>
      {!done && <>{hint ? <p className="sx-hint"><Lightbulb size={14}/> {cur.hint}</p> : <button className="table-action" onClick={() => setHint(true)}><Lightbulb size={14}/> Show a hint</button>}</>}
      {f && <div className={`sx-fb ${f.correct ? 'ok' : 'miss'}`} data-testid="text-feedback"><strong>{f.correct ? 'Correct.' : 'Not quite, and that is part of learning.'}</strong><p>{f.explanation}</p>{f.sourceName && <small>{f.sourceName}{f.sourceExcerpt ? `: "${f.sourceExcerpt}"` : ''}</small>}</div>}
    </div>}
    {err && <p className="form-error">{err}</p>}
    <div className="sx-actions"><Button variant="outline" disabled={idx === 0} onClick={() => { setIdx(idx - 1); setHint(false); }}><ArrowLeft size={14}/> Back</Button>
      {idx < nq - 1 ? <Button variant="outline" onClick={() => { setIdx(idx + 1); setHint(false); }}>Next <ArrowRight size={14}/></Button> : null}
      {done ? <Button onClick={() => setReview(false)}>Back to results</Button> : <Button data-testid="button-submit" disabled={!allIn || submit.isPending} onClick={finish}>{submit.isPending ? 'Checking...' : allIn ? 'Submit answers' : `Answer all ${nq} to submit`}</Button>}</div>
  </div>;
}
export default function StudentPlay() {
  const ac = useActiveClass();
  return <><PageHeading eyebrow="Practice and puzzle quest" title="Match, think, grow." description="Take your time. Pause whenever you like and pick up again later." action={<ClassSelect ac={ac}/>}/>
    <ClassGate ac={ac}>{id => <Play key={`${ac.scope}:${id}`} classId={id} scope={ac.scope} setClassId={ac.setClassId}/>}</ClassGate></>;
}
