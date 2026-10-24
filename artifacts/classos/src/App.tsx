import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import {
  Activity, ArrowRight, BookOpen, BookOpenCheck, Bot,
  Check, CheckCircle2, ChevronDown, CircleHelp, ClipboardCheck, Clock3, FileText,
  GraduationCap, KeyRound, Library, LogOut, Menu, MessageCircle, Plus, RefreshCw, School, Send,
  Sparkles, Users, X,
} from 'lucide-react';
import {
  useHealthCheck, useGetSchoolDashboard, useGetCurriculum, useCreateCurriculumEntry,
  useGetClasses, useCreateClass, useGetMaterials, useCreateMaterial, useGetAssignments,
  useCreateAssignment, useGetSubmissions, useSubmitAssignment, useGeneratePractice,
  useAskTutor, useGetMastery, getGetSchoolDashboardQueryKey, getGetCurriculumQueryKey,
  getGetClassesQueryKey, getGetMaterialsQueryKey, getGetAssignmentsQueryKey,
  getGetSubmissionsQueryKey, getGetMasteryQueryKey,
} from '@workspace/api-client-react';
import type { Assignment, PracticeQuestion } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Landing from '@/pages/landing';
import Onboarding from '@/pages/onboarding';
import AccessPage from '@/pages/access';
import { Button, Empty, FormField, Loading, Modal, PageHeading, Panel, QueryState, errMsg, formatDate, initials, inputClass, relativeDate } from '@/components/kit';
import { ACTIVE_CLASS_KEY, AccountContext, buildCtx, clearWorkspaceState, roleHome, useAccount, useAccountQuery, type Role } from '@/lib/account';
import { QueryClient } from '@tanstack/react-query';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 0, refetchOnWindowFocus: true, retry: 1 } } });

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}
if (!clerkPubKey) { throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file'); }

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "#315e51",
    colorForeground: "#203a34",
    colorMutedForeground: "#5d6b65",
    colorDanger: "#b5483a",
    colorBackground: "#fbf9f2",
    colorInput: "#ffffff",
    colorInputForeground: "#203a34",
    colorNeutral: "#203a34",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#fbf9f2] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[#e4e0d4]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[#203a34] font-semibold",
    headerSubtitle: "text-[#5d6b65]",
    socialButtonsBlockButtonText: "text-[#203a34]",
    formFieldLabel: "text-[#203a34]",
    footerActionLink: "text-[#315e51] font-semibold",
    footerActionText: "text-[#5d6b65]",
    dividerText: "text-[#5d6b65]",
    identityPreviewEditButton: "text-[#315e51]",
    formFieldSuccessText: "text-[#265344]",
    alertText: "text-[#203a34]",
    logoBox: "h-12 justify-center",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton: "border border-[#e4e0d4] bg-white",
    formButtonPrimary: "bg-[#315e51] hover:bg-[#274b41] text-white",
    formFieldInput: "bg-white border border-[#d8d3c4] text-[#203a34]",
    footerAction: "bg-transparent",
    dividerLine: "bg-[#e4e0d4]",
    alert: "bg-[#f6ecc8] border border-[#e4c879]",
    otpCodeFieldInput: "bg-white border border-[#d8d3c4] text-[#203a34]",
    formFieldRow: "",
    main: "",
  },
};

const navItems: Record<string, { href: string; label: string; icon: any }> = {
  school: { href: '/school', label: 'Overview', icon: School },
  curriculum: { href: '/school/curriculum', label: 'Master syllabus', icon: Library },
  classes: { href: '/classes', label: 'Class workspaces', icon: Users },
  access: { href: '/access', label: 'Access & invitations', icon: KeyRound },
  teacher: { href: '/teacher', label: 'Overview', icon: BookOpenCheck },
  materials: { href: '/materials', label: 'Class sources', icon: FileText },
  practice: { href: '/practice', label: 'Practice studio', icon: Sparkles },
  assignments: { href: '/assignments', label: 'Assignments', icon: ClipboardCheck },
  tutor: { href: '/tutor', label: 'Study tutor', icon: Bot },
  student: { href: '/student', label: 'My learning', icon: GraduationCap },
};
const navByRole: Record<Role, { label: string; items: string[] }[]> = {
  admin: [{ label: 'School', items: ['school', 'curriculum', 'classes', 'access'] }, { label: 'Teaching', items: ['teacher', 'materials', 'practice', 'assignments', 'tutor'] }],
  teacher: [{ label: 'Teaching', items: ['teacher', 'materials', 'practice', 'assignments', 'tutor', 'access'] }],
  student: [{ label: 'Learning', items: ['student', 'assignments', 'tutor', 'access'] }],
};
const routeTitles: Record<string, string> = {
  '/school': 'School overview', '/school/curriculum': 'Master syllabus', '/classes': 'Class workspaces',
  '/teacher': 'Teacher overview', '/materials': 'Class sources', '/practice': 'Practice studio',
  '/assignments': 'Assignments', '/student': 'My learning', '/tutor': 'Study tutor', '/access': 'Access & invitations',
};
const roleLabel: Record<Role, string> = { admin: 'School leader', teacher: 'Teacher', student: 'Student' };

function useRouteTitle() {
  const [p] = useLocation();
  useEffect(() => { document.title = `${routeTitles[p] || 'Learning workspace'} · ClassOS`; }, [p]);
}
function Guard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useAccount();
  if (!roles.includes(role)) return <Redirect to={roleHome(role)}/>;
  return <>{children}</>;
}
function AppShell() {
  useRouteTitle();
  const { account, role, schoolName } = useAccount();
  const { signOut } = useClerk();
  const [path, setPath] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const health = useHealthCheck();
  const title = routeTitles[path] || 'Learning workspace';
  const staff: Role[] = ['admin', 'teacher'];
  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={20}/></div><div><strong>ClassOS</strong><span>LEARNING, IN COMMON</span></div><button className="mobile-close" aria-label="Close navigation" onClick={() => setMobileOpen(false)}><X size={17}/></button></div>
      <div className="school-switch"><div className="school-seal">{schoolName.slice(0, 1).toUpperCase()}</div><div className="switch-copy"><strong data-testid="text-school-name">{schoolName}</strong><span>{roleLabel[role]}</span></div></div>
      <nav className="side-nav">{navByRole[role].map(group => <section className="nav-group" key={group.label}><div className="nav-label">{group.label}</div>{group.items.map(key => {
        const item = navItems[key]; const Icon = item.icon;
        return <Link key={item.href} href={item.href} data-testid={`nav-${item.href.replaceAll('/', '-').replace(/^-/, '')}`} className={`nav-link ${path === item.href ? 'nav-active' : ''}`} onClick={() => setMobileOpen(false)}><Icon size={17}/><span>{item.label}</span>{item.href === '/assignments' && <i className="nav-dot"/>}</Link>;
      })}</section>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-icon"><CircleHelp size={17}/></div><strong>Need a hand?</strong><p>Find your way around the learning workspace.</p><button onClick={() => setPath('/tutor')}>Visit the tutor <ArrowRight size={14}/></button></div><div className="sidebar-user"><div className="avatar avatar-gold">{initials(account.name)}</div><div><strong data-testid="text-user-name">{account.name}</strong><span>{schoolName}</span></div><button aria-label="Sign out" data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })}><LogOut size={14}/></button></div></div>
    </aside>
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)}/>}
    <main className="main-area">
      <header className="topbar"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>{schoolName}</span><span className="crumb-slash">/</span><strong>{title}</strong></div><div className="top-actions"><div className={`online-status ${health.isError ? 'status-error' : ''}`}><i/>{health.isLoading ? 'Checking connection' : health.isError ? 'Connection unavailable' : 'All systems ready'}</div><div className="avatar avatar-teal">{initials(account.name)}</div></div></header>
      <div className="content"><Switch>
        <Route path="/school"><Guard roles={['admin']}><SchoolPage/></Guard></Route>
        <Route path="/school/curriculum"><Guard roles={['admin']}><CurriculumPage/></Guard></Route>
        <Route path="/classes"><Guard roles={staff}><ClassesPage/></Guard></Route>
        <Route path="/access"><AccessPage/></Route>
        <Route path="/teacher"><Guard roles={staff}><TeacherPage/></Guard></Route>
        <Route path="/materials"><Guard roles={staff}><MaterialsPage/></Guard></Route>
        <Route path="/practice"><Guard roles={staff}><PracticePage/></Guard></Route>
        <Route path="/assignments"><AssignmentsPage/></Route>
        <Route path="/student"><Guard roles={['student']}><StudentPage/></Guard></Route>
        <Route path="/tutor"><TutorPage/></Route>
        <Route path="/"><Redirect to={roleHome(role)}/></Route>
        <Route path="/welcome"><Redirect to={roleHome(role)}/></Route>
        <Route component={NotFound}/>
      </Switch></div>
      <footer className="footer"><span>ClassOS <span className="footer-dot">·</span> Learning works better together.</span><span>{schoolName}</span></footer>
    </main>
  </div>;
}

function StaffAssignmentView({ a }: { a: Assignment }) {
  return <><div className="detail-head"><div className="eyebrow">STAFF VIEW · {a.topic.toUpperCase()}</div><h2>{a.title}</h2><p>{a.submittedCount} submitted. Students see only the prompts and options.</p></div>
    {a.questions.map((q, i) => <div className="student-question" key={q.id}><span className="question-num">QUESTION {String(i + 1).padStart(2, '0')}</span><h3>{q.prompt}</h3>
      {q.options.map((opt, n) => <div className={`option-line ${q.answerIndex === n ? 'option-answer' : ''}`} key={n}><span>{String.fromCharCode(65 + n)}</span>{opt}{q.answerIndex === n && <CheckCircle2 size={14}/>}</div>)}
      {q.explanation && <div className="answer-explain"><strong>Why this is right</strong><p>{q.explanation}</p></div>}
      {(q.sourceName || q.sourceExcerpt) && <div className="citation">{q.sourceName && <span><BookOpen size={13}/> {q.sourceName}</span>}{q.sourceExcerpt && <blockquote>“{q.sourceExcerpt}”</blockquote>}</div>}
      {q.answerIndex === undefined && <p className="staff-answer">The answer key is not available for this question.</p>}
    </div>)}</>;
}
function ClassPicker({ data, classId, onChange }: { data?: any[]; classId: number; onChange: (id: number) => void }) {
  return <label className="class-picker"><span>CLASS SPACE</span><select value={classId} onChange={e => onChange(Number(e.target.value))} aria-label="Choose class">{data?.map(c => <option key={c.id} value={c.id}>{c.name} · Grade {c.grade}</option>)}</select><ChevronDown size={15}/></label>;
}
function useData() {
  const client = useQueryClient();
  const { isAdmin, isStaff, scope } = useAccount();
  const storageKey = `${ACTIVE_CLASS_KEY}:${scope}`;
  const dashboard = useGetSchoolDashboard({ query: { enabled: isAdmin, queryKey: getGetSchoolDashboardQueryKey() } });
  const curriculum = useGetCurriculum({ query: { enabled: isAdmin, queryKey: getGetCurriculumQueryKey() } });
  const classes = useGetClasses({ query: { queryKey: getGetClassesQueryKey(), refetchInterval: 30000 } });
  const firstId = classes.data?.[0]?.id ?? 0;
  const [classId, setClassState] = useState<number>(() => { const saved = window.sessionStorage.getItem(storageKey); return saved ? Number(saved) : 0; });
  const setClassId = (id: number) => { setClassState(id); window.sessionStorage.setItem(storageKey, String(id)); };
  const activeClassId = classes.data?.some(c => c.id === classId) ? classId : firstId;
  const hasClasses = Boolean(classes.data?.length) && activeClassId > 0;
  const materials = useGetMaterials({ classId: activeClassId }, { query: { enabled: hasClasses && isStaff, queryKey: getGetMaterialsQueryKey({ classId: activeClassId }) } });
  const assignments = useGetAssignments({ classId: activeClassId }, { query: { enabled: hasClasses, queryKey: getGetAssignmentsQueryKey({ classId: activeClassId }) } });
  const assignmentId = assignments.data?.[0]?.id ?? 0;
  const submissions = useGetSubmissions(assignmentId, { query: { enabled: assignmentId > 0 && isStaff, queryKey: getGetSubmissionsQueryKey(assignmentId) } });
  const mastery = useGetMastery({ classId: activeClassId }, { query: { enabled: hasClasses, queryKey: getGetMasteryQueryKey({ classId: activeClassId }) } });
  const curriculumCreate = useCreateCurriculumEntry();
  const classCreate = useCreateClass();
  const materialCreate = useCreateMaterial();
  const assignmentCreate = useCreateAssignment();
  const submit = useSubmitAssignment();
  const generate = useGeneratePractice();
  const tutor = useAskTutor();
  const refresh = (keys: unknown[]) => keys.forEach(queryKey => client.invalidateQueries({ queryKey: queryKey as any }));
  return { dashboard, curriculum, classes, activeClassId, setClassId, materials, assignments, submissions, mastery, curriculumCreate, classCreate, materialCreate, assignmentCreate, submit, generate, tutor, refresh };
}

function SchoolPage() {
  const d = useData();
  const data = d.dashboard.data; const { account, schoolName } = useAccount(); const firstName = account.name.split(' ')[0] || 'there';
  return <><PageHeading eyebrow="A shared view of learning" title={`Good morning, ${firstName}.`} description={`A clear picture of what’s moving across ${schoolName}.`} action={<Button variant="outline" onClick={() => d.dashboard.refetch()}><RefreshCw size={15}/> Refresh view</Button>}/>
    <QueryState loading={d.dashboard.isLoading} error={d.dashboard.isError} onRetry={() => d.dashboard.refetch()}>{data && <>
      <div className="welcome-banner"><div className="banner-orbit orbit-one"/><div className="banner-orbit orbit-two"/><div className="banner-copy"><div className="banner-kicker">THIS WEEK AT {data.schoolName.toUpperCase()}</div><h2>Strong learning starts<br/>with shared direction.</h2><p>Here’s where your community is finding its rhythm.</p><Link href="/school/curriculum" className="banner-link">Explore the master syllabus <ArrowRight size={16}/></Link></div><div className="banner-illustration"><div className="book-stack"><span/><span/><span/></div><div className="sun-disc"/></div></div>
      <div className="metric-grid">{[
        { label: 'Teachers', value: data.teacherCount, hint: 'building together', icon: Users, tone: 'mint' },
        { label: 'Students', value: data.studentCount, hint: 'learning every day', icon: GraduationCap, tone: 'peach' },
        { label: 'Class spaces', value: data.classCount, hint: 'shared workspaces', icon: BookOpen, tone: 'yellow' },
        { label: 'Class sources', value: data.sourceCount, hint: 'grounded materials', icon: FileText, tone: 'blue' },
      ].map(m => <div className="metric-card" key={m.label}><div className={`metric-icon ${m.tone}`}><m.icon size={18}/></div><div className="metric-label">{m.label}</div><div className="metric-value">{m.value.toLocaleString()}</div><div className="metric-hint">{m.hint}</div></div>)}</div>
      <div className="overview-grid"><Panel title="A closer look" subtitle="Shared progress, at a glance"><div className="mastery-block"><div className="mastery-ring" style={{ '--value': `${data.masteryAverage}%` } as React.CSSProperties}><strong>{Math.round(data.masteryAverage)}<small>%</small></strong></div><div><span className="label-caps">AVERAGE MASTERY</span><h3>Learning is taking root.</h3><p>Keep connecting approved materials with meaningful practice.</p></div></div><div className="insight-row"><span className="insight-icon"><ClipboardCheck size={16}/></span><span><strong>{data.pendingSubmissions} submissions</strong> are still missing across classes</span><ArrowRight size={15}/></div></Panel>
      <Panel title="Recent activity" subtitle="A few moments from across your school" action={<span className="activity-live"><i/> Live</span>}>{data.recentActivity?.length ? <div className="activity-list">{data.recentActivity.slice(0, 5).map((item, i) => <div className="activity-item" key={item.id}><div className={`activity-marker marker-${i % 4}`}><Activity size={14}/></div><div className="activity-copy"><strong>{item.label}</strong><span>{item.detail}</span></div><time>{relativeDate(item.happenedAt)}</time></div>)}</div> : <Empty title="Your story starts here" detail="New school activity will show up here as your community works."/>}</Panel></div>
    </>}</QueryState></>;
}

function CurriculumPage() {
  const d = useData(); const [open, setOpen] = useState(false); const [subject, setSubject] = useState(''); const [grade, setGrade] = useState(''); const [unit, setUnit] = useState(''); const [chapter, setChapter] = useState(''); const [topic, setTopic] = useState(''); const [standard, setStandard] = useState('');
  const save = (e: FormEvent) => { e.preventDefault(); d.curriculumCreate.mutate({ data: { subject, grade, unit, chapter, topic, standard } }, { onSuccess: () => { d.refresh([getGetCurriculumQueryKey(), getGetSchoolDashboardQueryKey()]); setOpen(false); setSubject(''); setGrade(''); setUnit(''); setChapter(''); setTopic(''); setStandard(''); } }); };
  return <><PageHeading eyebrow="School · Coherence" title="Master syllabus" description="The shared map that keeps every class moving in the same direction." action={<Button onClick={() => setOpen(true)}><Plus size={16}/> Add syllabus topic</Button>}/><QueryState loading={d.curriculum.isLoading} error={d.curriculum.isError} onRetry={() => d.curriculum.refetch()}>{d.curriculum.data && <Panel title="Curriculum map" subtitle={`${d.curriculum.data.length} approved learning points`}><div className="table-wrap"><table className="data-table"><thead><tr><th>Subject & grade</th><th>Unit</th><th>Chapter</th><th>Topic</th><th>Standard</th></tr></thead><tbody>{d.curriculum.data.map(row => <tr key={row.id}><td><strong>{row.subject}</strong><small>Grade {row.grade}</small></td><td>{row.unit}</td><td>{row.chapter}</td><td><span className="topic-pill">{row.topic}</span></td><td className="mono-cell">{row.standard || '—'}</td></tr>)}</tbody></table>{!d.curriculum.data.length && <Empty icon={Library} title="A map built together" detail="Add the first approved topic to give teachers a shared starting point." action={<Button onClick={() => setOpen(true)}><Plus size={15}/> Add first topic</Button>}/>}</div></Panel>}</QueryState>
    {open && <Modal title="Add a syllabus topic" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={save}><div className="form-two"><FormField label="Subject"><input required className={inputClass} value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Life science"/></FormField><FormField label="Grade"><input required className={inputClass} value={grade} onChange={e => setGrade(e.target.value)} placeholder="e.g. 6"/></FormField></div><FormField label="Unit"><input required className={inputClass} value={unit} onChange={e => setUnit(e.target.value)} placeholder="Unit name"/></FormField><div className="form-two"><FormField label="Chapter"><input required className={inputClass} value={chapter} onChange={e => setChapter(e.target.value)} placeholder="Chapter"/></FormField><FormField label="Topic"><input required className={inputClass} value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic"/></FormField></div><FormField label="Standard (optional)"><input className={inputClass} value={standard} onChange={e => setStandard(e.target.value)} placeholder="Learning standard"/></FormField>{d.curriculumCreate.isError && <p className="form-error">Couldn’t save this topic. Please try again.</p>}<div className="modal-actions"><Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={d.curriculumCreate.isPending}>{d.curriculumCreate.isPending ? 'Adding…' : 'Add topic'}</Button></div></form></Modal>}</>;
}

function ClassesPage() {
  const [, setPath] = useLocation(); const { isAdmin } = useAccount(); const d = useData(); const [open, setOpen] = useState(false); const [name, setName] = useState(''); const [grade, setGrade] = useState(''); const [subject, setSubject] = useState('');
  const save = (e: FormEvent) => { e.preventDefault(); d.classCreate.mutate({ data: { name, grade, subject } }, { onSuccess: () => { d.refresh([getGetClassesQueryKey(), getGetSchoolDashboardQueryKey()]); setOpen(false); setName(''); setGrade(''); setSubject(''); } }); };
  return <><PageHeading eyebrow="Shared grade & subject spaces" title="Class workspaces" description="A home for approved sources, focused practice, and the people learning together." action={isAdmin ? <Button onClick={() => setOpen(true)}><Plus size={16}/> Create class space</Button> : undefined}/><QueryState loading={d.classes.isLoading} error={d.classes.isError} onRetry={() => d.classes.refetch()}>{d.classes.data && <>{d.classes.data.length ? <div className="class-grid">{d.classes.data.map((c, i) => <article className={`class-card class-tone-${i % 4}`} key={c.id}><div className="class-card-top"><div className="class-monogram">{c.subject.slice(0, 1)}</div><span className="topic-pill">Grade {c.grade}</span></div><h2>{c.name}</h2><p>{c.subject} <span>·</span> {c.teacherName}</p><div className="class-progress-label"><span>Class mastery</span><strong>{Math.round(c.masteryAverage)}%</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, c.masteryAverage))}%` }}/></div><div className="class-card-bottom"><span><Users size={15}/> {c.studentCount} learners</span><button aria-label={`Open ${c.name}`} onClick={() => { d.setClassId(c.id); setOpen(false); setPath('/teacher'); }}><ArrowRight size={17}/></button></div></article>)}</div> : <Empty icon={Users} title="Make room for learning" detail="Create the first shared class space for a grade and subject." action={isAdmin ? <Button onClick={() => setOpen(true)}><Plus size={15}/> Create class space</Button> : undefined}/>}</>}</QueryState>
    {isAdmin && open && <Modal title="Create a class space" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={save}><FormField label="Class name"><input required className={inputClass} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Room 12 • Life science"/></FormField><div className="form-two"><FormField label="Grade"><input required className={inputClass} value={grade} onChange={e => setGrade(e.target.value)} placeholder="6"/></FormField><FormField label="Subject"><input required className={inputClass} value={subject} onChange={e => setSubject(e.target.value)} placeholder="Life science"/></FormField></div><p className="field-help">Teachers are added after the class exists. Use Access &amp; invitations to invite or assign them.</p>{d.classCreate.isError && <p className="form-error">Couldn’t create this class. Please try again.</p>}<div className="modal-actions"><Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={d.classCreate.isPending}>{d.classCreate.isPending ? 'Creating…' : 'Create space'}</Button></div></form></Modal>}</>;
}

function TeacherPage() {
  const d = useData(); const classCount = d.classes.data?.length ?? 0;
  const topicSummary = d.mastery.data?.students.flatMap(student => student.topics).reduce((result, item) => {
    const existing = result.find(topic => topic.topic === item.topic);
    if (existing) { existing.score += item.score; existing.count += 1; }
    else result.push({ topic: item.topic, score: item.score, count: 1 });
    return result;
  }, [] as { topic: string; score: number; count: number }[]) ?? [];
  return <><PageHeading eyebrow="Teacher desk" title="Make the learning yours." description="Approved sources in. Thoughtful practice out. You’re in control at every step."/><div className="teacher-hero"><div><span className="banner-kicker">YOUR CLASSROOM RHYTHM</span><h2>Turn shared direction<br/>into meaningful practice.</h2><p>Choose a class space to find materials and create source-grounded questions for your learners.</p><Link href="/materials" className="banner-link">Browse class sources <ArrowRight size={16}/></Link></div><div className="teacher-graphic"><div className="graphic-paper"><div/><div/><div/></div><div className="graphic-orbit"/></div></div><QueryState loading={d.classes.isLoading} error={d.classes.isError} onRetry={() => d.classes.refetch()}><div className="quick-stats"><div className="quick-stat"><span className="quick-stat-icon"><BookOpen size={17}/></span><div><strong>{classCount}</strong><span>Class spaces</span></div><Link href="/classes"><ArrowRight size={15}/></Link></div><div className="quick-stat"><span className="quick-stat-icon peach-bg"><FileText size={17}/></span><div><strong>{d.materials.data?.length ?? 0}</strong><span>Sources in view</span></div><Link href="/materials"><ArrowRight size={15}/></Link></div><div className="quick-stat"><span className="quick-stat-icon yellow-bg"><ClipboardCheck size={17}/></span><div><strong>{d.assignments.data?.length ?? 0}</strong><span>Published assignments</span></div><Link href="/assignments"><ArrowRight size={15}/></Link></div></div>{d.classes.data?.length ? <Panel title="Your shared classrooms" subtitle="Pick up where your learners are"><div className="table-wrap"><table className="data-table"><thead><tr><th>Class space</th><th>Subject</th><th>Learners</th><th>Mastery</th><th></th></tr></thead><tbody>{d.classes.data.map(c => <tr key={c.id}><td><strong>{c.name}</strong><small>Grade {c.grade}</small></td><td>{c.subject}</td><td>{c.studentCount}</td><td><span className="mastery-value">{Math.round(c.masteryAverage)}%</span></td><td><button className="table-action" onClick={() => d.setClassId(c.id)}>Select class <ArrowRight size={14}/></button></td></tr>)}</tbody></table></div></Panel> : <Empty icon={BookOpen} title="Your classroom awaits" detail="A school leader can create a shared class space for your work."/>}{topicSummary.length > 0 && <Panel title="Topic mastery" subtitle="A class view of where understanding is growing"><div className="topic-mastery-list">{topicSummary.slice(0, 5).map(item => <div className="topic-mastery-row" key={item.topic}><div><span>{item.topic}</span><strong>{Math.round(item.score / item.count)}%</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, item.score / item.count))}%` }}/></div></div>)}</div></Panel>}</QueryState></>;
}

function MaterialsPage() {
  const d = useData(); const [open, setOpen] = useState(false); const [title, setTitle] = useState(''); const [sourceName, setSourceName] = useState(''); const [topic, setTopic] = useState(''); const [sourceText, setSourceText] = useState('');
  const save = (e: FormEvent) => { e.preventDefault(); d.materialCreate.mutate({ data: { classId: d.activeClassId, title, sourceName, topic, sourceText } }, { onSuccess: () => { d.refresh([getGetMaterialsQueryKey({ classId: d.activeClassId }), getGetSchoolDashboardQueryKey()]); setOpen(false); setTitle(''); setSourceName(''); setTopic(''); setSourceText(''); } }); };
  return <><PageHeading eyebrow="Teacher · Source library" title="Start with what’s approved." description="Keep the learning grounded in the materials your school has agreed to teach." action={<Button onClick={() => setOpen(true)} disabled={!d.classes.data?.length}><Plus size={16}/> Add a source</Button>}/><div className="toolbar"><ClassPicker data={d.classes.data} classId={d.activeClassId} onChange={d.setClassId}/><div className="source-note"><span className="note-check"><Check size={13}/></span> Only these sources ground tutor answers and practice</div></div><QueryState loading={d.materials.isLoading} error={d.materials.isError} onRetry={() => d.materials.refetch()}>{d.materials.data && <>{d.materials.data.length ? <div className="material-grid">{d.materials.data.map(m => <article className="material-card" key={m.id}><div className="material-top"><span className="material-file"><FileText size={18}/></span><span className="source-type">APPROVED SOURCE</span></div><h2>{m.title}</h2><div className="material-source">{m.sourceName}</div><p>{m.sourceText.slice(0, 190)}{m.sourceText.length > 190 ? '…' : ''}</p><div className="material-footer"><span className="topic-pill">{m.topic}</span><time>{relativeDate(m.createdAt)}</time></div></article>)}</div> : <Empty icon={FileText} title="No sources in this class yet" detail="Add an approved text source. Practice and the tutor will use this material as their shared foundation." action={<Button disabled={!d.classes.data?.length} onClick={() => setOpen(true)}><Plus size={15}/> Add first source</Button>}/>}</>}</QueryState>
    {open && <Modal title="Add a class source" onClose={() => setOpen(false)}><form className="modal-form" onSubmit={save}><FormField label="Source title"><input required className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. How plants move water"/></FormField><div className="form-two"><FormField label="Source name"><input required className={inputClass} value={sourceName} onChange={e => setSourceName(e.target.value)} placeholder="Textbook or resource"/></FormField><FormField label="Topic"><input required className={inputClass} value={topic} onChange={e => setTopic(e.target.value)} placeholder="Topic"/></FormField></div><FormField label="Source text"><textarea required minLength={20} maxLength={16000} className={`${inputClass} textarea`} value={sourceText} onChange={e => setSourceText(e.target.value)} placeholder="Paste the approved passage for this class. At least 20 characters."/><small className="field-help">{sourceText.length} / 16,000 characters</small></FormField>{d.materialCreate.isError && <p className="form-error">Couldn’t save this source. Please try again.</p>}<div className="modal-actions"><Button variant="outline" type="button" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={d.materialCreate.isPending || sourceText.length < 20}>{d.materialCreate.isPending ? 'Saving…' : 'Save approved source'}</Button></div></form></Modal>}</>;
}

function PracticePage() {
  const d = useData(); const [topic, setTopic] = useState(''); const [count, setCount] = useState('3'); const [questions, setQuestions] = useState<PracticeQuestion[]>([]); const [approved, setApproved] = useState<Record<string, boolean>>({}); const [title, setTitle] = useState(''); const [dueDate, setDueDate] = useState('');
  const generate = (e: FormEvent) => { e.preventDefault(); setQuestions([]); d.generate.mutate({ data: { classId: d.activeClassId, topic, count: Number(count) } }, { onSuccess: items => { setQuestions(items); setApproved(Object.fromEntries(items.map(q => [q.id, true]))); } }); };
  const publish = (e: FormEvent) => { e.preventDefault(); const reviewed = questions.filter(q => approved[q.id]); if (!reviewed.length) return; d.assignmentCreate.mutate({ data: { classId: d.activeClassId, title: title.trim(), topic, dueDate, questions: reviewed } }, { onSuccess: () => { d.refresh([getGetAssignmentsQueryKey({ classId: d.activeClassId }), getGetSchoolDashboardQueryKey()]); setQuestions([]); setTitle(''); setDueDate(''); } }); };
  return <><PageHeading eyebrow="Teacher · Practice studio" title="Questions with a paper trail." description="Generate from your approved class sources. Review every question before it reaches a student."/><div className="toolbar"><ClassPicker data={d.classes.data} classId={d.activeClassId} onChange={id => { d.setClassId(id); setQuestions([]); }}/><span className="approval-reminder"><CheckCircle2 size={15}/> Teacher review is always required</span></div><div className="practice-layout"><div className="practice-controls"><div className="step-number">01 <span>BUILD A SET</span></div><h2>What are they learning?</h2><p>Choose a topic from the class source material to keep questions connected to the syllabus.</p><form className="modal-form" onSubmit={generate}><FormField label="Topic"><input required className={inputClass} value={topic} onChange={e => setTopic(e.target.value)} placeholder="e.g. Plant transport"/></FormField><FormField label="Number of questions"><select className={inputClass} value={count} onChange={e => setCount(e.target.value)}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n} questions</option>)}</select></FormField><Button disabled={d.generate.isPending || !d.classes.data?.length}><Sparkles size={15}/>{d.generate.isPending ? 'Finding the right questions…' : 'Generate practice'}</Button>{d.generate.isError && <p className="form-error">Couldn’t generate questions. Confirm there are approved sources for this topic and try again.</p>}</form><div className="source-grounding"><BookOpen size={17}/><span><strong>Grounded, not guessed.</strong><br/>Each question includes a citation from this class’s materials.</span></div></div>
    <div className="review-column"><div className="review-head"><div><div className="step-number">02 <span>TEACHER REVIEW</span></div><h2>Check before sharing</h2></div>{questions.length > 0 && <span className="review-count">{Object.values(approved).filter(Boolean).length} / {questions.length} approved</span>}</div>{questions.length ? <>{questions.map((q, i) => <article className="question-card" key={q.id}><div className="question-top"><span className="question-num">QUESTION {String(i + 1).padStart(2, '0')}</span><label className="approve-toggle"><input type="checkbox" checked={!!approved[q.id]} onChange={e => setApproved(prev => ({ ...prev, [q.id]: e.target.checked }))}/><span><Check size={12}/></span> Approve</label></div><h3>{q.prompt}</h3><div className="question-options">{q.options.map((option, j) => <div className={`option-line ${j === q.answerIndex ? 'option-answer' : ''}`} key={j}><span>{String.fromCharCode(65 + j)}</span>{option}{j === q.answerIndex && <CheckCircle2 size={14}/>}</div>)}</div><div className="answer-explain"><strong>Why this is right</strong><p>{q.explanation}</p></div><div className="citation"><span><BookOpen size={13}/> {q.sourceName} · {q.topic}</span><blockquote>“{q.sourceExcerpt}”</blockquote></div></article>)}<form className="publish-box" onSubmit={publish}><div className="publish-fields"><FormField label="Assignment title"><input required className={inputClass} value={title} onChange={e => setTitle(e.target.value)} placeholder="A thoughtful title"/></FormField><FormField label="Due date"><input required type="date" className={inputClass} value={dueDate} onChange={e => setDueDate(e.target.value)}/></FormField></div>{d.assignmentCreate.isError && <p className="form-error">Couldn’t publish this assignment. Try again.</p>}<Button disabled={!Object.values(approved).some(Boolean) || d.assignmentCreate.isPending}><ClipboardCheck size={15}/>{d.assignmentCreate.isPending ? 'Publishing…' : `Publish ${Object.values(approved).filter(Boolean).length} approved question${Object.values(approved).filter(Boolean).length === 1 ? '' : 's'}`}</Button></form></> : <div className="review-empty"><div className="review-empty-mark"><Sparkles size={23}/></div><h3>Your review desk is ready.</h3><p>Generate a set to begin. Each question arrives with its answer, explanation, and source excerpt for you to check.</p><div className="review-steps"><span><i>1</i>Generate</span><span><i>2</i>Review</span><span><i>3</i>Publish</span></div></div>}</div></div></>;
}

function AssignmentsPage() {
  const { account, isStudent } = useAccount(); const d = useData(); const [selected, setSelected] = useState<Assignment | null>(null); const [answers, setAnswers] = useState<number[]>([]); const [submitted, setSubmitted] = useState(false);
  const assign = d.assignments.data ?? [];
  const subs = useGetSubmissions(selected?.id ?? 0, { query: { enabled: !!selected, queryKey: getGetSubmissionsQueryKey(selected?.id ?? 0) } });
  const alreadySubmitted = isStudent && !!subs.data?.length;
  const choose = (a: Assignment) => { setSelected(a); setAnswers(a.questions.map(() => -1)); setSubmitted(false); };
  const submitAnswers = (e: FormEvent) => { e.preventDefault(); if (!selected) return; d.submit.mutate({ assignmentId: selected.id, data: { answers } }, { onSuccess: () => { setSubmitted(true); d.refresh([getGetSubmissionsQueryKey(selected.id), getGetMasteryQueryKey({ classId: d.activeClassId }), getGetAssignmentsQueryKey({ classId: d.activeClassId }), getGetSchoolDashboardQueryKey()]); } }); };
  return <><PageHeading eyebrow="Assignments · Shared work" title="Learning in motion." description="Teachers can follow progress; students can pick up the next small step."/><div className="toolbar"><ClassPicker data={d.classes.data} classId={d.activeClassId} onChange={id => { d.setClassId(id); setSelected(null); }}/><div className="segmented"><span className="segment-active">Assignments</span><span>Submissions</span></div></div><QueryState loading={d.assignments.isLoading} error={d.assignments.isError} onRetry={() => d.assignments.refetch()}>{assign.length ? <div className="assignment-layout"><div className="assignment-list">{assign.map((a, i) => <button className={`assignment-row ${selected?.id === a.id ? 'assignment-selected' : ''}`} onClick={() => choose(a)} key={a.id}><div className={`assignment-index idx-${i % 3}`}>{String(i + 1).padStart(2, '0')}</div><div className="assignment-copy"><strong>{a.title}</strong><span>{a.topic} <i>·</i> {a.questions.length} questions</span></div><div className="assignment-date"><span>{a.status}</span><time>Due {formatDate(a.dueDate)}</time></div><ArrowRight size={16}/></button>)}<Panel title={isStudent ? 'Your submission' : 'Submissions'} subtitle={isStudent ? 'One attempt per assignment' : 'Learner work turned in for this class'} className="submission-panel">{!selected ? <p className="subtle-empty">Select an assignment to see its submissions.</p> : subs.isLoading ? <Loading rows={2}/> : subs.isError ? <div className="inline-error">Submissions are temporarily unavailable.</div> : subs.data?.length ? <div className="submission-list">{subs.data.map(s => <div className="submission-row" key={s.id}><div className="avatar avatar-peach">{initials(s.studentName)}</div><div><strong>{s.studentName}</strong><span>{relativeDate(s.submittedAt)}</span></div><div className="score">{Math.round(s.score)}<small>%</small></div></div>)}</div> : <p className="subtle-empty">No submissions yet. Student work will appear here.</p>}</Panel></div><div className="assignment-detail">{selected ? !isStudent ? <StaffAssignmentView a={selected}/> : (submitted || alreadySubmitted) ? <div className="submitted-screen"><div className="success-mark"><Check size={25}/></div><div className="eyebrow">SUBMISSION RECEIVED</div><h2>Nicely done, {account.name.split(' ')[0] || 'friend'}.</h2><p>Your answers are in. Your teacher can now see your progress.</p><Button variant="outline" onClick={() => setSelected(null)}>Back to assignments</Button></div> : <><div className="detail-head"><div className="eyebrow">STUDENT VIEW · {selected.topic.toUpperCase()}</div><h2>{selected.title}</h2><p>Take your time. Read each question carefully.</p></div><form onSubmit={submitAnswers}>{selected.questions.map((q, i) => <div className="student-question" key={q.id}><span className="question-num">QUESTION {String(i + 1).padStart(2, '0')}</span><h3>{q.prompt}</h3>{q.options.map((opt, n) => <label className={`student-option ${answers[i] === n ? 'student-option-selected' : ''}`} key={n}><input type="radio" name={`answer-${q.id}`} checked={answers[i] === n} onChange={() => setAnswers(prev => prev.map((v, j) => j === i ? n : v))}/><span>{String.fromCharCode(65 + n)}</span>{opt}</label>)}</div>)}{d.submit.isError && <p className="form-error">{errMsg(d.submit.error, 'We couldn’t send your answers just yet. Please try again.')}</p>}<Button disabled={answers.some(a => a < 0) || d.submit.isPending}><Send size={15}/>{d.submit.isPending ? 'Sending answers…' : 'Submit my answers'}</Button></form></> : <Empty icon={ClipboardCheck} title="Choose an assignment" detail="Pick an assignment to see its questions and student view."/>}</div></div> : <Empty icon={ClipboardCheck} title="A little breathing room" detail="No assignments for this class yet. A teacher can publish reviewed practice from the Practice studio." action={isStudent ? undefined : <Link href="/practice" className="button button-primary">Open practice studio <ArrowRight size={15}/></Link>}/>}</QueryState></>;
}

function StudentPage() {
  const { account } = useAccount(); const d = useData(); const mine = d.mastery.data?.students?.[0]?.topics ?? []; const assignments = d.assignments.data ?? []; const due = assignments.filter(a => a.status.toLowerCase() !== 'complete');
  return <><PageHeading eyebrow="Your learning space" title={`One step at a time, ${account.name.split(' ')[0] || 'friend'}.`} description="Your teacher has chosen these learning materials and practice just for your class."/><div className="student-welcome"><div className="student-welcome-copy"><span className="banner-kicker">A PLACE TO LEARN AT YOUR PACE</span><h2>Curiosity is a good<br/>place to start.</h2><p>Every question here comes from the class materials you’re learning together.</p><Link href="/tutor" className="banner-link">Ask the study tutor <ArrowRight size={16}/></Link></div><div className="student-art"><div className="paper-sun"/><div className="paper-book"><span/><span/><span/></div><div className="paper-star">✳</div></div></div><div className="student-dashboard-grid"><div className="student-work"><div className="section-title"><div><div className="eyebrow">READY WHEN YOU ARE</div><h2>Your assignments</h2></div><span className="small-count">{due.length} to do</span></div><QueryState loading={d.assignments.isLoading} error={d.assignments.isError} onRetry={() => d.assignments.refetch()}>{assignments.length ? <div className="student-assignment-list">{assignments.map((a, i) => <Link href="/assignments" key={a.id} className="student-assignment-card"><div className={`task-glyph glyph-${i % 3}`}><BookOpen size={18}/></div><div><span className="task-topic">{a.topic}</span><h3>{a.title}</h3><span className="task-meta"><Clock3 size={13}/> Due {formatDate(a.dueDate)} <i>·</i> {a.questions.length} questions</span></div><ArrowRight size={17}/></Link>)}</div> : <Empty icon={BookOpen} title="No work waiting right now" detail="When your teacher shares an assignment, it will be here."/>}</QueryState></div><div className="student-side"><Panel title="Your class" subtitle="Learning together"><ClassPicker data={d.classes.data} classId={d.activeClassId} onChange={d.setClassId}/><div className="class-subject-card"><div className="avatar avatar-teal">{initials(d.classes.data?.find(c => c.id === d.activeClassId)?.name ?? 'Class')}</div><div><strong>{d.classes.data?.find(c => c.id === d.activeClassId)?.name ?? 'Class space'}</strong><span>{d.classes.data?.find(c => c.id === d.activeClassId)?.subject ?? 'Shared class learning'}</span></div></div></Panel><Panel title="A little help goes a long way" subtitle="Need another explanation?"><div className="tutor-nudge"><div className="tutor-nudge-icon"><MessageCircle size={18}/></div><p>Ask a question and get a patient explanation from your class materials.</p><Link href="/tutor" className="text-link">Talk it through <ArrowRight size={14}/></Link></div></Panel>{mine.length > 0 && <Panel title="Your mastery" subtitle="Your progress in this class"><div className="topic-mastery-list">{mine.slice(0, 5).map(t => <div className="topic-mastery-row" key={t.topic}><div><span>{t.topic}</span><strong>{Math.round(t.score)}%</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, t.score))}%` }}/></div></div>)}</div></Panel>}</div></div></>;
}

function TutorPage() {
  const d = useData(); const [question, setQuestion] = useState(''); const [mode, setMode] = useState<'hint' | 'explain'>('explain');
  const ask = (e: FormEvent) => { e.preventDefault(); d.tutor.mutate({ data: { classId: d.activeClassId, question, mode } }); };
  return <><PageHeading eyebrow="Student · Study support" title="Let’s think it through." description="A patient study partner that stays close to what your class has learned."/><div className="tutor-layout"><aside className="tutor-context"><div className="tutor-orb"><Bot size={26}/></div><div className="eyebrow">YOUR CLASS MATERIALS</div><h2>Help that stays on the page.</h2><p>Ask for a hint or a clear explanation. Answers use the sources your teacher added for this class.</p><ClassPicker data={d.classes.data} classId={d.activeClassId} onChange={id => { d.setClassId(id); d.tutor.reset(); }}/><div className="context-divider"/><div className="context-stat"><span>Approved sources</span><strong>{d.materials.data ? d.materials.data.length : 'Class sources'}</strong></div><div className="context-stat"><span>Response style</span><strong>{mode === 'hint' ? 'Gentle hint' : 'Explain it'}</strong></div></aside><div className="tutor-conversation"><div className="conversation-top"><div><span className="online-status"><i/> Ready to help</span><h2>Study conversation</h2></div><button className="icon-button" aria-label="Clear conversation" onClick={() => d.tutor.reset()}><RefreshCw size={16}/></button></div><div className="conversation-body">{!d.tutor.data && !d.tutor.isPending ? <div className="conversation-empty"><div className="conversation-empty-icon"><MessageCircle size={21}/></div><h3>What are you wondering about?</h3><p>Try asking about a term, an idea, or a step in your class material.</p><div className="prompt-chips">{['Can you give me a hint?', 'Explain this idea simply'].map((text, i) => <button key={text} onClick={() => { setQuestion(text); setMode(i === 0 ? 'hint' : 'explain'); }}><Sparkles size={13}/>{text}</button>)}</div></div> : null}{d.tutor.isPending && <div className="assistant-message"><div className="tutor-avatar"><Bot size={16}/></div><div className="message-bubble loading-answer"><span/><span/><span/></div></div>}{d.tutor.data && <><div className="user-message"><span>{question}</span></div><div className="assistant-message"><div className="tutor-avatar"><Bot size={16}/></div><div className="assistant-content">{d.tutor.data.grounded ? <div className="grounded-badge"><CheckCircle2 size={13}/> From your class materials</div> : <div className="unavailable-badge"><CircleHelp size={13}/> No matching class source found</div>}<div className="message-bubble">{d.tutor.data.answer}</div>{d.tutor.data.grounded && d.tutor.data.citations?.length ? <div className="citation-list"><div className="citation-title"><BookOpen size={13}/> WHAT I USED</div>{d.tutor.data.citations.map((citation, i) => <div className="tutor-citation" key={`${citation.sourceName}-${i}`}><strong>{citation.sourceName}</strong><span>{citation.topic}</span><blockquote>“{citation.excerpt}”</blockquote></div>)}</div> : <p className="grounding-note">Try asking about a topic covered in one of your class sources, or ask your teacher to add a material.</p>}</div></div></>}{d.tutor.isError && <div className="tutor-error"><span>That didn’t come through. Try again when you’re ready.</span><Button variant="outline" onClick={() => d.tutor.mutate({ data: { classId: d.activeClassId, question, mode } })}>Try again</Button></div>}</div><form className="tutor-compose" onSubmit={ask}><div className="compose-modes"><button type="button" className={mode === 'hint' ? 'mode-active' : ''} onClick={() => setMode('hint')}>Give me a hint</button><button type="button" className={mode === 'explain' ? 'mode-active' : ''} onClick={() => setMode('explain')}>Explain it</button></div><div className="compose-row"><textarea className={inputClass} required minLength={3} maxLength={1200} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Ask about something from class…" aria-label="Ask a study question"/><Button disabled={d.tutor.isPending || question.trim().length < 3 || !d.classes.data?.length} aria-label="Send question"><Send size={16}/></Button></div><span className="compose-footnote"><BookOpen size={12}/> Answers are grounded in approved class sources.</span></form></div></div></>;
}


function FullLoading() { return <div className="full-loading"><div><Loading rows={3}/></div></div>; }
function AccountError({ onRetry }: { onRetry: () => void }) {
  return <div className="full-loading"><div className="state-card"><div className="state-symbol"><RefreshCw size={20}/></div><h3>We couldn't check your account</h3><p>Try again in a moment.</p><Button variant="outline" onClick={onRetry}><RefreshCw size={15}/> Try again</Button></div></div>;
}
function SignedInHome() {
  const q = useAccountQuery();
  if (q.isLoading) return <FullLoading/>;
  if (q.isError || !q.data) return <AccountError onRetry={() => q.refetch()}/>;
  const m = q.data.membership;
  return <Redirect to={m ? roleHome(m.role as Role) : '/welcome'}/>;
}
function HomeRedirect() {
  return <><Show when="signed-in"><SignedInHome/></Show><Show when="signed-out"><Landing/></Show></>;
}
function AccountGate() {
  const q = useAccountQuery(); const client = useQueryClient();
  const { userId } = useAuth();
  const account = q.data; const m = account?.membership;
  const key = account ? (m ? `${account.userId}:${m.id}:${m.role}:${m.schoolId}:${m.role === 'admin' ? 'school-wide' : [...m.classIds].sort((a, b) => a - b).join(',')}` : `${account.userId}:none`) : null;
  const prev = useRef<string | null>(null);
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (key === null) return;
    if (prev.current !== null && prev.current !== key) {
      clearWorkspaceState();
      client.removeQueries({ predicate: query => query.queryKey[0] !== '/api/account' });
    }
    prev.current = key;
    setReadyKey(key);
  }, [key, client]);
  if (q.isLoading) return <FullLoading/>;
  if (q.isError || !account) return <AccountError onRetry={() => q.refetch()}/>;
  if (account.userId !== userId || readyKey !== key) return <FullLoading/>;
  if (!m) return <Onboarding account={account}/>;
  return <AccountContext.Provider value={buildCtx(account, m)}><AppShell key={key}/></AccountContext.Provider>;
}
function ProtectedApp() {
  const { isLoaded, isSignedIn } = useAuth();
  if (!isLoaded) return <FullLoading/>;
  if (!isSignedIn) return <Redirect to="/"/>;
  return <AccountGate/>;
}
function SignInPage() {
  return <div className="auth-page"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}
function SignUpPage() {
  return <div className="auth-page"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}
function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        client.clear();
        clearWorkspaceState();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, client]);
  return null;
}
function RoutedErrorBoundary({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back to ClassOS", subtitle: "Sign in to your school workspace" } },
        signUp: { start: { title: "Create your ClassOS account", subtitle: "Then start a school or join with an invitation" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <RoutedErrorBoundary>
            <Switch>
              <Route path="/" component={HomeRedirect} />
              <Route path="/sign-in/*?" component={SignInPage} />
              <Route path="/sign-up/*?" component={SignUpPage} />
              <Route component={ProtectedApp} />
            </Switch>
          </RoutedErrorBoundary>
          <Toaster/>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}
function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
