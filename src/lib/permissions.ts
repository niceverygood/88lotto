import type { Role } from '@/types/db'
import { navIcons } from '@/design-system/icons'

export type NavKey = keyof typeof navIcons
export type NavAccessMap = Record<string, Role[]>

// 모듈(메뉴) 평면 목록 — 권한 매트릭스 행 순서.
export const NAV_KEYS = Object.keys(navIcons) as NavKey[]

export const MODULE_LABEL: Record<NavKey, string> = {
  dashboard: '대시보드',
  members: '이용자',
  payments: '결제',
  revenue: '매출',
  myCustomers: '나의고객',
  community: '커뮤니티',
  support: '고객센터',
  lotto: '로또기록',
  bets: '베팅',
  admins: '관리자',
  logs: '로그',
  stats: '통계',
  settings: '설정',
}

export const ROLE_ORDER: Role[] = ['admin', 'manager', 'leader', 'rep']

export const ROLE_LABEL: Record<Role, string> = {
  admin: '관리자',
  manager: '실장',
  leader: '팀장',
  rep: '담당자',
}

// 자기잠금 방지: admin 은 이 모듈 접근을 항상 보유(매트릭스에서 해제 불가).
export const ADMIN_LOCKED: NavKey[] = ['admins', 'logs']

// 메뉴 노출 기본 매트릭스 (CLAUDE §5). 권한관리(/admins/roles)에서 편집 → DB nav_access 로 영속.
// 데이터 접근은 RLS(lib/rls/policies.sql)로 이중 통제.
// TODO(live-verify): `08 권한관리` 화면 미확인 → 아래는 합리적 기본값. ASSUMPTIONS 기록.
export const DEFAULT_NAV_ACCESS: Record<NavKey, Role[]> = {
  dashboard: ['admin', 'manager', 'leader', 'rep'],
  members: ['admin', 'manager', 'leader', 'rep'],
  payments: ['admin', 'manager', 'leader', 'rep'],
  revenue: ['admin', 'manager', 'leader'],
  myCustomers: ['admin', 'manager', 'leader', 'rep'],
  community: ['admin', 'manager', 'leader', 'rep'],
  support: ['admin', 'manager', 'leader', 'rep'],
  lotto: ['admin', 'manager', 'leader', 'rep'],
  bets: ['admin', 'manager', 'leader', 'rep'],
  admins: ['admin'],
  logs: ['admin'],
  stats: ['admin', 'manager', 'leader'],
  settings: ['admin', 'manager'],
}

/** 주어진 매트릭스(없으면 기본값)로 접근 판정. admin 의 잠금 모듈은 항상 허용. */
export function canAccessWith(map: NavAccessMap | undefined, role: Role | null, key: NavKey): boolean {
  if (!role) return false
  if (role === 'admin' && ADMIN_LOCKED.includes(key)) return true
  const roles = map?.[key] ?? DEFAULT_NAV_ACCESS[key]
  return roles.includes(role)
}

/** 정적 폴백 — 기본 매트릭스 기준(맵 미주입 호출용). */
export function canAccess(role: Role | null, key: NavKey): boolean {
  return canAccessWith(DEFAULT_NAV_ACCESS, role, key)
}
