import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Role } from '@/types/db'
import { dataSource, supabase } from './supabase'
import { genId, mutateDb, nowIso, readDb } from './db/store'

// 세션·역할 (DECISIONS D1/Phase 2). mock 모드는 staff 레코드 기반 데모 로그인,
// supabase 모드는 supabase.auth 세션 기반. 컴포넌트는 훅(useCurrentUser/useRole)만 사용.

export interface CurrentUser {
  id: string
  name: string
  loginId: string
  role: Role
  teamId: string | null
}

export interface SignInResult {
  ok: boolean
  error?: string
}

interface SessionState {
  currentUser: CurrentUser | null
  /** loginId(mock) 또는 email(supabase) 로 로그인. */
  signIn: (identifier: string, password?: string) => Promise<SignInResult>
  signOut: () => Promise<void>
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      currentUser: null,

      async signIn(identifier, password) {
        if (dataSource === 'supabase' && supabase) {
          const { data, error } = await supabase.auth.signInWithPassword({
            email: identifier.trim(),
            password: password ?? '',
          })
          if (error || !data.user) {
            return { ok: false, error: error?.message ?? '로그인에 실패했습니다.' }
          }
          // TODO(live-verify): auth user → staff 레코드(역할/팀) 매핑. 임시로 user_metadata 사용.
          const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>
          set({
            currentUser: {
              id: data.user.id,
              name: (meta.name as string) ?? data.user.email ?? '',
              loginId: data.user.email ?? identifier,
              role: (meta.role as Role) ?? 'rep',
              teamId: (meta.team_id as string) ?? null,
            },
          })
          return { ok: true }
        }

        // mock: staff.login_id 매칭
        const staff = readDb().staff.find(
          (s) => s.login_id.toLowerCase() === identifier.trim().toLowerCase(),
        )
        if (!staff) return { ok: false, error: '존재하지 않는 계정입니다.' }
        if (!staff.is_active) return { ok: false, error: '비활성화된 계정입니다.' }

        const ts = nowIso()
        // §8: 로그인 → staff.last_login_at 갱신 + admin_log 적재
        mutateDb((db) => {
          const row = db.staff.find((s) => s.id === staff.id)
          if (row) row.last_login_at = ts
          db.logs.push({
            id: genId('log'),
            kind: 'admin',
            actor: staff.id,
            action: 'auth.login',
            target_type: 'staff',
            target_id: staff.id,
            meta: {},
            created_at: ts,
          })
        })
        set({
          currentUser: {
            id: staff.id,
            name: staff.name,
            loginId: staff.login_id,
            role: staff.role,
            teamId: staff.team_id,
          },
        })
        return { ok: true }
      },

      async signOut() {
        if (dataSource === 'supabase' && supabase) await supabase.auth.signOut()
        set({ currentUser: null })
      },
    }),
    {
      name: 'pluslotto-session',
      // TODO(live-verify): supabase 모드는 onAuthStateChange 로 세션 복원하도록 보강.
      partialize: (s) => ({ currentUser: s.currentUser }),
    },
  ),
)

export function useCurrentUser(): CurrentUser | null {
  return useSessionStore((s) => s.currentUser)
}

export function useRole(): Role | null {
  return useSessionStore((s) => s.currentUser?.role ?? null)
}

export function useSignIn() {
  return useSessionStore((s) => s.signIn)
}

export function useSignOut() {
  return useSessionStore((s) => s.signOut)
}
