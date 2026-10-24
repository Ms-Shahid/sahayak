import { Link } from 'wouter';
import { ArrowRight, BookOpen, BookOpenCheck, GraduationCap, School, ShieldCheck } from 'lucide-react';

const roles = [
  { icon: School, name: 'School leaders', text: 'Set the master syllabus, create class spaces, and decide exactly who joins each one.' },
  { icon: BookOpenCheck, name: 'Teachers', text: 'Add approved sources, review every generated question, and publish practice with an answer trail.' },
  { icon: GraduationCap, name: 'Students', text: 'Work through assigned practice and ask a tutor that only draws on your class materials.' },
];
export default function Landing() {
  return <div className="landing">
    <header className="landing-nav"><div className="landing-brand"><div className="brand-mark"><BookOpen size={20}/></div><strong>ClassOS</strong></div><nav><Link href="/sign-in" className="landing-link" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="button button-primary" data-testid="link-sign-up">Create account</Link></nav></header>
    <section className="landing-hero"><div><div className="banner-kicker">LEARNING, IN COMMON</div><h1>One approved curriculum.<br/>Three connected workspaces.</h1><p>ClassOS connects school leaders, teachers, and students around the materials your school has agreed to teach, with private accounts and access that follows each person's role.</p><div className="landing-cta"><Link href="/sign-up" className="button button-primary">Get started <ArrowRight size={16}/></Link><Link href="/sign-in" className="button button-outline">I already have an account</Link></div></div>
      <div className="landing-art" aria-hidden="true"><div className="book-stack"><span/><span/><span/></div><div className="sun-disc"/></div></section>
    <section className="landing-roles"><div className="eyebrow">BUILT FOR EVERYONE IN THE ROOM</div><h2>Every role gets a real workspace.</h2><div className="landing-role-list">{roles.map(r => <div className="landing-role" key={r.name}><r.icon size={22}/><div><h3>{r.name}</h3><p>{r.text}</p></div></div>)}</div></section>
    <section className="landing-trust"><ShieldCheck size={26}/><div><h2>Invitation-only by design.</h2><p>Join a school with a private token your administrator or teacher shares with you. Answer keys stay with staff, and students only ever see their own progress.</p></div></section>
    <footer className="footer"><span>ClassOS <span className="footer-dot">·</span> Learning works better together.</span></footer>
  </div>;
}
