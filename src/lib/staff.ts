// 운영자(staff)·팀 참조 데이터 — 여러 모듈이 담당자명/역할/팀을 해석할 때 공유.
// 컴포넌트는 useStaff/useTeams 훅, api 내부 로직은 동기 헬퍼를 쓴다.
import { useQuery } from '@tanstack/react-query'
import type { Role, Staff } from '@/types/db'
import { readDb } from './db/store'

export const staffKeys = {
  all: ['staff'] as const,
  teams: ['teams'] as const,
}

export function useStaff() {
  return useQuery({ queryKey: staffKeys.all, queryFn: () => readDb().staff })
}

export function useTeams() {
  return useQuery({ queryKey: staffKeys.teams, queryFn: () => readDb().teams })
}

// ── 동기 헬퍼 (api 계층/필터 ctx 용 — 훅 아님) ───────────────────────────
export function staffById(): Record<string, Staff> {
  const out: Record<string, Staff> = {}
  for (const s of readDb().staff) out[s.id] = s
  return out
}

export function staffNameById(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const s of readDb().staff) out[s.id] = s.name
  return out
}

export function staffRoleById(): Record<string, Role> {
  const out: Record<string, Role> = {}
  for (const s of readDb().staff) out[s.id] = s.role
  return out
}

export function teamNameById(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of readDb().teams) out[t.id] = t.name
  return out
}

/** 배정 가능한 활성 운영자(담당 후보). 자동할당은 rep 만 라운드로빈. */
export function activeStaff(): Staff[] {
  return readDb().staff.filter((s) => s.is_active)
}

export function assignableReps(): Staff[] {
  return readDb().staff.filter((s) => s.is_active && s.role === 'rep')
}
