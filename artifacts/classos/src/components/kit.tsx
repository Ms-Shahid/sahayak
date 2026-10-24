import type { ReactNode } from 'react';
import { BookOpen, RefreshCw, X } from 'lucide-react';

export const inputClass = 'field';
export function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-heading page-enter"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}
export function Button({ children, variant = 'primary', ...props }: { children: ReactNode; variant?: string; [key: string]: any }) {
  return <button className={`button button-${variant}`} {...props}>{children}</button>;
}
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>;
}
export function Loading({ rows = 3 }: { rows?: number }) { return <div className="skeleton-stack" aria-label="Loading"><div className="skeleton skeleton-title"/>{Array.from({ length: rows }, (_, i) => <div className="skeleton skeleton-row" key={i}/>)}</div>; }
export function QueryState({ loading, error, onRetry, children }: { loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode }) {
  if (loading) return <Loading/>;
  if (error) return <div className="state-card"><div className="state-symbol"><RefreshCw size={20}/></div><h3>We couldn't load this just now</h3><p>Your work is safe. Try again in a moment.</p><Button variant="outline" onClick={onRetry}><RefreshCw size={15}/> Try again</Button></div>;
  return <>{children}</>;
}
export function Empty({ icon: Icon = BookOpen, title, detail, action }: { icon?: any; title: string; detail: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={23}/></div><h3>{title}</h3><p>{detail}</p>{action}</div>;
}
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><div className="modal-head"><h2>{title}</h2><button aria-label="Close" className="icon-button" onClick={onClose}><X size={18}/></button></div>{children}</section></div>;
}
export function FormField({ label, children }: { label: string; children: ReactNode }) { return <label className="form-field"><span>{label}</span>{children}</label>; }
export function errMsg(e: unknown, fallback = 'Something went wrong. Please try again.') {
  const any = e as any;
  return (typeof any?.data?.error === 'string' && any.data.error) || fallback;
}
export function relativeDate(value: string) { if (!value) return 'Recently'; const date = new Date(value); if (Number.isNaN(date.getTime())) return value; const days = Math.floor((Date.now() - date.getTime()) / 86400000); if (days <= 0) return 'Today'; if (days === 1) return 'Yesterday'; if (days < 7) return `${days} days ago`; return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
export function formatDate(value: string) { if (!value) return 'No due date'; const date = new Date(`${value.slice(0, 10)}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
export function initials(value: string) { return value.split(/\s+/).slice(0, 2).map(word => word[0] || '').join('').toUpperCase(); }
