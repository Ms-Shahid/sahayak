import { createContext, useContext, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { BookOpen, GraduationCap, School, Users } from 'lucide-react';
import { useGetDemoUsers, useGetMe, useLogin, useLogout } from '@workspace/api-client-react';
import type { AppUser } from '@workspace/api-client-react';

export type Role = AppUser['role'];

type AuthState = { user: AppUser; classIds: number[]; signOut: () => void };
const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthGate>');
  return value;
}

export const homeFor: Record<Role, string> = { admin: '/school', teacher: '/teacher', student: '/student' };
const roleLabel: Record<Role, string> = { admin: 'Admin', teacher: 'Teacher', student: 'Student' };
const roleIcon = { admin: School, teacher: Users, student: GraduationCap };
const roleBlurb: Record<Role, string> = {
  admin: 'Sets up access, school sources and policy',
  teacher: 'Uploads class sources and publishes practice',
  student: 'Learns from published material and the tutor',
};

function LoginScreen() {
  const client = useQueryClient();
  const users = useGetDemoUsers();
  const login = useLogin();
  const groups: Role[] = ['admin', 'teacher', 'student'];
  const signIn = (userId: number) =>
    login.mutate({ data: { userId } }, { onSuccess: () => { client.clear(); window.location.assign('/'); } });
  return <div className="login-screen"><div className="login-card">
    <div className="brand-mark login-mark"><BookOpen size={22}/></div>
    <h1>Sign in to ClassOS</h1>
    <p className="login-sub">Demo workspace for Northstar Academy. Pick a seeded user to see what each role can do.</p>
    {users.isLoading && <p>Loading demo users…</p>}
    {users.isError && <p className="form-error">The server is not reachable. Start the API server and refresh.</p>}
    {users.data && groups.map(role => { const Icon = roleIcon[role]; const list = users.data.filter(u => u.role === role); if (!list.length) return null; return <section key={role} className="login-group">
      <div className="login-group-head"><Icon size={16}/><strong>{roleLabel[role]}</strong><span>{roleBlurb[role]}</span></div>
      <div className="login-users">{list.map(u => <button key={u.id} className="login-user" disabled={login.isPending} onClick={() => signIn(u.id)} data-testid={`login-${u.id}`}><span className="avatar avatar-teal">{u.name.split(/\s+/).slice(0, 2).map(w => w[0]).join('')}</span><span>{u.name}<small>{u.email}</small></span></button>)}</div>
    </section>; })}
    {login.isError && <p className="form-error">Sign-in failed. Please try again.</p>}
  </div></div>;
}

/** Shows the sign-in screen until the server session resolves to a user. */
export function AuthGate({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const me = useGetMe({ query: { retry: false, staleTime: 60_000 } as any });
  const logout = useLogout();
  if (me.isLoading) return <div className="login-screen"><div className="login-card"><p>Loading…</p></div></div>;
  if (me.isError || !me.data) return <LoginScreen/>;
  const signOut = () => logout.mutate(undefined, { onSettled: () => { client.clear(); window.location.assign('/'); } });
  return <AuthContext.Provider value={{ user: me.data.user, classIds: me.data.classIds, signOut }}>{children}</AuthContext.Provider>;
}
