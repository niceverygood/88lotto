// 이용자 모듈 데이터 훅 (CLAUDE §1·§8). 전부 TanStack Query 경유 —
// 컴포넌트 직접 fetch 금지. 뮤테이션은 mock DB 를 변경하고 §8 흐름대로
// 로그/배정/문자 부수효과를 만든 뒤 관련 쿼리를 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Grade, LogEntry, Member, MemberStatus } from '@/types/db'
import { genId, mutateDb, nowIso, readDb } from '@/lib/db/store'
import { staffById, staffRoleById, assignableReps } from '@/lib/staff'
import { useCurrentUser, type CurrentUser } from '@/lib/auth'
import { memberKeys, smsTemplateKeys } from '@/lib/queryKeys'
import { renderSms, smsTypeForTemplate } from '@/lib/sms'
import { filterMembers, getView, MEMBER_VIEWS, type MemberFilter } from './views'

export { memberKeys }

// ── RLS 에뮬레이션: 역할별 데이터 스코프 (mock). 실 전환 시 RLS 가 대신. ──
function scopeMembers(all: readonly Member[], user: CurrentUser | null): Member[] {
  if (!user) return []
  if (user.role === 'admin' || user.role === 'manager') return [...all]
  if (user.role === 'leader') return all.filter((m) => m.team_id === user.teamId)
  return all.filter((m) => m.assigned_staff_id === user.id) // rep = 본인 담당
}

// ── 정렬 ──────────────────────────────────────────────────────────────
type SortVal = string | number
function sortValue(m: Member, id: string): SortVal | null {
  switch (id) {
    case 'name':
      return m.name
    case 'user_id':
      return m.user_id
    case 'grade':
      return m.grade
    case 'status':
      return m.status
    case 'registered_at':
      return Date.parse(m.registered_at)
    case 'last_active_at':
      return m.last_active_at ? Date.parse(m.last_active_at) : null
    default:
      return null
  }
}

function sortMembers(rows: Member[], sortId: string, desc: boolean): Member[] {
  const dir = desc ? -1 : 1
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sortId)
    const vb = sortValue(b, sortId)
    if (va === null && vb === null) return 0
    if (va === null) return 1 // null 은 항상 뒤로
    if (vb === null) return -1
    if (va < vb) return -1 * dir
    if (va > vb) return 1 * dir
    return 0
  })
}

// ── 공통 헬퍼 ─────────────────────────────────────────────────────────
function adminLog(
  actor: string | null,
  action: string,
  targetId: string | null,
  meta: Record<string, unknown> = {},
): LogEntry {
  return {
    id: genId('log'),
    kind: 'admin',
    actor,
    action,
    target_type: 'member',
    target_id: targetId,
    meta,
    created_at: nowIso(),
  }
}

function syncStatusFlags(m: Member): void {
  m.is_suspended = m.status === 'suspended'
  m.is_deleted = m.status === 'deleted'
  m.is_withdrawn = m.status === 'withdrawn'
}

export interface MemberPatch {
  grade?: Grade
  status?: MemberStatus
  memo?: string | null
  tendency?: string | null
  outcall_done?: boolean
}

function applyPatch(m: Member, patch: MemberPatch): void {
  Object.assign(m, patch)
  if (patch.status) syncStatusFlags(m)
}

// ── 목록 ──────────────────────────────────────────────────────────────
export interface MembersQuery {
  view?: string
  search?: string
  extra?: MemberFilter // FilterBar 추가 필터 (뷰 위에 병합)
  page: number // 1-based
  pageSize: number
  sortId?: string
  sortDesc?: boolean
}

export interface MembersResult {
  rows: Member[]
  total: number // scope+filter 후, 페이지네이션 전
  pageCount: number
}

// 목록/카운트 공통 코어 — base(이미 스코프된 회원 배열)에 뷰·필터·정렬·페이지를 적용.
function listFrom(base: readonly Member[], q: MembersQuery): MembersResult {
  const view = getView(q.view)
  const filter: MemberFilter = { ...view.filter, ...q.extra, search: q.search }
  const ctx = { now: Date.now(), staffRoleById: staffRoleById() }
  const filtered = filterMembers(base, filter, ctx)
  const sorted = q.sortId
    ? sortMembers(filtered, q.sortId, q.sortDesc ?? false)
    : sortMembers(filtered, 'registered_at', true) // 기본: 최신가입 우선
  const total = sorted.length
  const start = (q.page - 1) * q.pageSize
  return {
    rows: sorted.slice(start, start + q.pageSize),
    total,
    pageCount: Math.max(1, Math.ceil(total / q.pageSize)),
  }
}

function countsFrom(base: readonly Member[]): Record<string, number> {
  const ctx = { now: Date.now(), staffRoleById: staffRoleById() }
  const out: Record<string, number> = {}
  for (const v of MEMBER_VIEWS) out[v.key] = filterMembers(base, v.filter, ctx).length
  return out
}

export function useMembers(q: MembersQuery) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.list({ ...q, uid: user?.id ?? 'anon', role: user?.role ?? 'none' }),
    queryFn: (): MembersResult => listFrom(scopeMembers(readDb().members, user), q),
    placeholderData: (prev) => prev, // 페이지/정렬 전환 시 깜빡임 방지
  })
}

/** 각 뷰의 건수(스코프 적용, 검색 제외) — 탭/드롭다운 배지용. */
export function useMemberViewCounts() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.counts(`${user?.id ?? 'anon'}:${user?.role ?? 'none'}`),
    queryFn: (): Record<string, number> => countsFrom(scopeMembers(readDb().members, user)),
  })
}

// ── 나의고객 (CLAUDE §4 나의고객) — '내가 담당하는' 회원만(assigned_staff_id===나).
// 역할 RLS 스코프와 달리, manager/leader 도 '본인 담당' 케이스로드만 본다.
function scopeMine(all: readonly Member[], user: CurrentUser | null): Member[] {
  if (!user) return []
  return all.filter((m) => m.assigned_staff_id === user.id)
}

export function useMyCustomers(q: MembersQuery) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.list({ ...q, scope: 'mine', uid: user?.id ?? 'anon' }),
    queryFn: (): MembersResult => listFrom(scopeMine(readDb().members, user), q),
    placeholderData: (prev) => prev,
  })
}

export function useMyCustomerCounts() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.counts(`mine:${user?.id ?? 'anon'}`),
    queryFn: (): Record<string, number> => countsFrom(scopeMine(readDb().members, user)),
  })
}

export interface MySmsRow {
  id: string
  member_id: string
  member_name: string
  phone: string
  body: string
  type: string
  status: string
  sent_at: string | null
}

/** 내 담당 회원에게 발송된 문자 내역(최신순) — 나의고객 문자 발송 센터용. */
export function useMySmsLog(limit = 80) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: ['my-sms', user?.id ?? 'anon', limit],
    queryFn: (): MySmsRow[] => {
      const db = readDb()
      const mine = new Map(scopeMine(db.members, user).map((m) => [m.id, m.name]))
      return db.sms_sends
        .filter((s) => mine.has(s.member_id))
        .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? ''))
        .slice(0, limit)
        .map((s) => ({
          id: s.id,
          member_id: s.member_id,
          member_name: mine.get(s.member_id) ?? s.member_id,
          phone: s.phone,
          body: s.body,
          type: s.type,
          status: s.status,
          sent_at: s.sent_at,
        }))
    },
  })
}

export function useSmsTemplates() {
  return useQuery({ queryKey: smsTemplateKeys.all, queryFn: () => readDb().sms_templates })
}

export function useProducts() {
  return useQuery({ queryKey: ['products'], queryFn: () => readDb().products })
}

export function useMember(id: string | null) {
  return useQuery({
    queryKey: memberKeys.detail(id ?? ''),
    queryFn: () => readDb().members.find((m) => m.id === id) ?? null,
    enabled: !!id,
  })
}

export function useMemberPayments(id: string | null) {
  return useQuery({
    queryKey: memberKeys.payments(id ?? ''),
    queryFn: () =>
      readDb()
        .payments.filter((p) => p.member_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    enabled: !!id,
  })
}

export function useMemberSms(id: string | null) {
  return useQuery({
    queryKey: memberKeys.sms(id ?? ''),
    queryFn: () =>
      readDb()
        .sms_sends.filter((s) => s.member_id === id)
        .sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '')),
    enabled: !!id,
  })
}

export function useMemberAssignments(id: string | null) {
  return useQuery({
    queryKey: memberKeys.assignments(id ?? ''),
    queryFn: () =>
      readDb()
        .assignments.filter((a) => a.member_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    enabled: !!id,
  })
}

// ── 뮤테이션 ──────────────────────────────────────────────────────────
function useInvalidateMembers() {
  const qc = useQueryClient()
  return (ids?: string[]) => {
    qc.invalidateQueries({ queryKey: memberKeys.all }) // list + counts
    for (const id of ids ?? []) qc.invalidateQueries({ queryKey: memberKeys.detail(id) })
  }
}

/** 단건 필드 수정(등급/상태/메모/성향/아웃콜). 담당 변경은 useAssignStaff 사용. */
export function useUpdateMember() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { id: string; patch: MemberPatch }) => {
      mutateDb((db) => {
        const m = db.members.find((x) => x.id === v.id)
        if (!m) return
        const before: MemberPatch = { grade: m.grade, status: m.status }
        applyPatch(m, v.patch)
        db.logs.push(adminLog(user?.id ?? null, 'member.update', v.id, { patch: v.patch, before }))
      })
      return v.id
    },
    onSuccess: (id) => invalidate([id]),
  })
}

/** 상태/유입분류 등 일괄 패치. */
export function useBulkUpdateMembers() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[]; patch: MemberPatch & { inflow_type?: string } }) => {
      mutateDb((db) => {
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          if (v.patch.inflow_type !== undefined) m.inflow_type = v.patch.inflow_type
          applyPatch(m, v.patch)
        }
        db.logs.push(
          adminLog(user?.id ?? null, 'member.bulk_update', null, {
            count: v.ids.length,
            ids: v.ids,
            patch: v.patch,
          }),
        )
      })
      return v.ids
    },
    onSuccess: (ids) => invalidate(ids),
  })
}

/** 담당자 수동 배정. members.assigned_staff_id/team_id 갱신 + assignments 로그(§8). */
export function useAssignStaff() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[]; staffId: string }) => {
      const staff = staffById()[v.staffId]
      const teamId = staff?.team_id ?? null
      mutateDb((db) => {
        const ts = nowIso()
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          m.assigned_staff_id = v.staffId
          m.team_id = teamId
          db.assignments.push({
            id: genId('as'),
            member_id: m.id,
            staff_id: v.staffId,
            assigned_by: user?.id ?? null,
            type: 'manual',
            created_at: ts,
          })
        }
        db.logs.push(
          adminLog(user?.id ?? null, 'member.assign', null, {
            count: v.ids.length,
            staff_id: v.staffId,
          }),
        )
      })
      return v.ids
    },
    onSuccess: (ids) => invalidate(ids),
  })
}

/** 자동할당 — 활성 rep 라운드로빈. */
export function useAutoAssign() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[] }) => {
      const reps = assignableReps()
      if (reps.length === 0) return v.ids
      mutateDb((db) => {
        const ts = nowIso()
        let i = 0
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          const rep = reps[i % reps.length]
          i++
          m.assigned_staff_id = rep.id
          m.team_id = rep.team_id
          db.assignments.push({
            id: genId('as'),
            member_id: m.id,
            staff_id: rep.id,
            assigned_by: user?.id ?? null,
            type: 'auto',
            created_at: ts,
          })
        }
        db.logs.push(
          adminLog(user?.id ?? null, 'member.auto_assign', null, { count: v.ids.length }),
        )
      })
      return v.ids
    },
    onSuccess: (ids) => invalidate(ids),
  })
}

/** 담당 리셋 — 미지정으로 되돌림. */
export function useResetAssign() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[] }) => {
      mutateDb((db) => {
        const ts = nowIso()
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          m.assigned_staff_id = null
          m.team_id = null
          db.assignments.push({
            id: genId('as'),
            member_id: m.id,
            staff_id: null,
            assigned_by: user?.id ?? null,
            type: 'manual',
            created_at: ts,
          })
        }
        db.logs.push(
          adminLog(user?.id ?? null, 'member.reset_assign', null, { count: v.ids.length }),
        )
      })
      return v.ids
    },
    onSuccess: (ids) => invalidate(ids),
  })
}

// ── 문자 발송 (개별/일괄) — sms_sends 생성 + 회원 문자내역 + 문자로그(§8) ──
export function useSendSms() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { ids: string[]; templateKey: string }) => {
      mutateDb((db) => {
        const tpl = db.sms_templates.find((t) => t.key === v.templateKey)
        const ts = nowIso()
        const type = smsTypeForTemplate(v.templateKey)
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          db.sms_sends.push({
            id: genId('sms'),
            member_id: m.id,
            template_key: v.templateKey,
            phone: m.phone,
            body: tpl ? renderSms(tpl.body, m) : '',
            type,
            status: '발송완료',
            sent_at: ts,
          })
        }
        db.logs.push({
          id: genId('log'),
          kind: 'sms',
          actor: user?.id ?? null,
          action: 'sms.send',
          target_type: 'member',
          target_id: null,
          meta: { count: v.ids.length, template: v.templateKey },
          created_at: ts,
        })
      })
      return v.ids
    },
    onSuccess: (ids) => {
      qc.invalidateQueries({ queryKey: memberKeys.all })
      qc.invalidateQueries({ queryKey: ['my-sms'] }) // 나의고객 문자내역(§8)
      for (const id of ids) qc.invalidateQueries({ queryKey: memberKeys.sms(id) })
    },
  })
}
