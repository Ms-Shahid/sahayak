import { createContext, useContext } from 'react';
import { useGetAccount, getGetAccountQueryKey } from '@workspace/api-client-react';
import type { Account, SchoolMember } from '@workspace/api-client-react';

export type Role = 'admin' | 'teacher' | 'student';
export interface AccountCtx {
  account: Account; membership: SchoolMember; role: Role; schoolName: string; scope: string;
  isAdmin: boolean; isTeacher: boolean; isStudent: boolean; isStaff: boolean;
}
export const AccountContext = createContext<AccountCtx | null>(null);
export function useAccount() {
  const v = useContext(AccountContext);
  if (!v) throw new Error('useAccount used outside a signed-in school workspace');
  return v;
}
export function buildCtx(account: Account, membership: SchoolMember): AccountCtx {
  const role = membership.role as Role;
  return { account, membership, role, schoolName: account.schoolName || 'Your school', scope: `${account.userId}:${membership.id}`,
    isAdmin: role === 'admin', isTeacher: role === 'teacher', isStudent: role === 'student', isStaff: role !== 'student' };
}
export function roleHome(role: Role) { return role === 'admin' ? '/school' : role === 'teacher' ? '/teacher' : '/student'; }
export function useAccountQuery() {
  return useGetAccount({ query: { queryKey: getGetAccountQueryKey(), staleTime: 0, refetchInterval: 20000, refetchOnWindowFocus: 'always' } });
}
export const ACTIVE_CLASS_KEY = 'classos-active-class';
export function clearWorkspaceState() {
  try { Object.keys(window.sessionStorage).filter(k => k.startsWith(ACTIVE_CLASS_KEY)).forEach(k => window.sessionStorage.removeItem(k)); } catch { /* ignore */ }
}
