// 이용자 모듈 데이터 훅 (CLAUDE §1·§8). 전부 TanStack Query 경유 —
// 컴포넌트 직접 fetch 금지. 뮤테이션은 mock DB 를 변경하고 §8 흐름대로
// 로그/배정/문자 부수효과를 만든 뒤 관련 쿼리를 무효화한다.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Grade, LogEntry, Member, MemberStatus, Role, SmsSend, Staff } from '@/types/db'
import { genId, mutateDb, nowIso, readDb } from '@/lib/db/store'
import { dataSource } from '@/lib/supabase'
import { staffById, staffRoleById, assignableReps } from '@/lib/staff'
import { useCurrentUser, type CurrentUser } from '@/lib/auth'
import { memberKeys, smsTemplateKeys } from '@/lib/queryKeys'
import { renderSms, smsTypeForTemplate } from '@/lib/sms'
import { sendOneShot } from '@/lib/oneshot'
import { filterMembers, getView, MEMBER_VIEWS, type MemberFilter } from './views'
import * as supa from './supa'

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
// roleMap(assigned_staff_id→role)은 모드별 출처(mock=staffRoleById / supabase=fetchStaffRoleMap)에서 주입.
function listFrom(base: readonly Member[], q: MembersQuery, roleMap: Record<string, Role>): MembersResult {
  const view = getView(q.view)
  const filter: MemberFilter = { ...view.filter, ...q.extra, search: q.search }
  const ctx = { now: Date.now(), staffRoleById: roleMap }
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

function countsFrom(base: readonly Member[], roleMap: Record<string, Role>): Record<string, number> {
  const ctx = { now: Date.now(), staffRoleById: roleMap }
  const out: Record<string, number> = {}
  for (const v of MEMBER_VIEWS) out[v.key] = filterMembers(base, v.filter, ctx).length
  return out
}

export function useMembers(q: MembersQuery) {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.list({ ...q, uid: user?.id ?? 'anon', role: user?.role ?? 'none' }),
    queryFn: async (): Promise<MembersResult> => {
      if (dataSource === 'supabase') {
        const [base, roleMap] = await Promise.all([supa.fetchScopedMembers(), supa.fetchStaffRoleMap()])
        return listFrom(base, q, roleMap)
      }
      return listFrom(scopeMembers(readDb().members, user), q, staffRoleById())
    },
    placeholderData: (prev) => prev, // 페이지/정렬 전환 시 깜빡임 방지
  })
}

/** 각 뷰의 건수(스코프 적용, 검색 제외) — 탭/드롭다운 배지용. */
export function useMemberViewCounts() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.counts(`${user?.id ?? 'anon'}:${user?.role ?? 'none'}`),
    queryFn: async (): Promise<Record<string, number>> => {
      if (dataSource === 'supabase') {
        const [base, roleMap] = await Promise.all([supa.fetchScopedMembers(), supa.fetchStaffRoleMap()])
        return countsFrom(base, roleMap)
      }
      return countsFrom(scopeMembers(readDb().members, user), staffRoleById())
    },
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
    queryFn: async (): Promise<MembersResult> => {
      if (dataSource === 'supabase') {
        const [base, roleMap] = await Promise.all([
          supa.fetchMineMembers(user?.id ?? ''),
          supa.fetchStaffRoleMap(),
        ])
        return listFrom(base, q, roleMap)
      }
      return listFrom(scopeMine(readDb().members, user), q, staffRoleById())
    },
    placeholderData: (prev) => prev,
  })
}

export function useMyCustomerCounts() {
  const user = useCurrentUser()
  return useQuery({
    queryKey: memberKeys.counts(`mine:${user?.id ?? 'anon'}`),
    queryFn: async (): Promise<Record<string, number>> => {
      if (dataSource === 'supabase') {
        const [base, roleMap] = await Promise.all([
          supa.fetchMineMembers(user?.id ?? ''),
          supa.fetchStaffRoleMap(),
        ])
        return countsFrom(base, roleMap)
      }
      return countsFrom(scopeMine(readDb().members, user), staffRoleById())
    },
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
    queryFn: async (): Promise<MySmsRow[]> => {
      if (dataSource === 'supabase') return supa.fetchMineSmsLog(user?.id ?? '', limit)
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
  return useQuery({
    queryKey: smsTemplateKeys.all,
    queryFn: () => (dataSource === 'supabase' ? supa.fetchSmsTemplates() : readDb().sms_templates),
  })
}

export function useProducts() {
  return useQuery({
    queryKey: ['products'],
    queryFn: () => (dataSource === 'supabase' ? supa.fetchProducts() : readDb().products),
  })
}

export function useMember(id: string | null) {
  return useQuery({
    queryKey: memberKeys.detail(id ?? ''),
    queryFn: () =>
      dataSource === 'supabase'
        ? supa.fetchMember(id ?? '')
        : readDb().members.find((m) => m.id === id) ?? null,
    enabled: !!id,
  })
}

export function useMemberPayments(id: string | null) {
  return useQuery({
    queryKey: memberKeys.payments(id ?? ''),
    queryFn: async () =>
      (dataSource === 'supabase'
        ? await supa.fetchMemberPayments(id ?? '')
        : readDb().payments.filter((p) => p.member_id === id)
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    enabled: !!id,
  })
}

export function useMemberSms(id: string | null) {
  return useQuery({
    queryKey: memberKeys.sms(id ?? ''),
    queryFn: async () =>
      (dataSource === 'supabase'
        ? await supa.fetchMemberSms(id ?? '')
        : readDb().sms_sends.filter((s) => s.member_id === id)
      ).sort((a, b) => (b.sent_at ?? '').localeCompare(a.sent_at ?? '')),
    enabled: !!id,
  })
}

export function useMemberAssignments(id: string | null) {
  return useQuery({
    queryKey: memberKeys.assignments(id ?? ''),
    queryFn: async () =>
      (dataSource === 'supabase'
        ? await supa.fetchMemberAssignments(id ?? '')
        : readDb().assignments.filter((a) => a.member_id === id)
      ).sort((a, b) => b.created_at.localeCompare(a.created_at)),
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
      if (dataSource === 'supabase') {
        await supa.updateMember(v.id, v.patch, user?.id ?? null)
        return v.id
      }
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
      if (dataSource === 'supabase') {
        await supa.bulkUpdateMembers(v.ids, v.patch, user?.id ?? null)
        return v.ids
      }
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

// ── 회원 단건 등록 (§V2-2 DB 입력) ────────────────────────────────────
export interface MemberCreateInput {
  name: string
  phone: string
  user_id?: string | null
  nickname?: string | null
  grade?: Grade
  inflow_code?: string | null
  inflow_type?: string | null
  tendency?: string | null
  memo?: string | null
  assigned_staff_id?: string | null
}

const onlyDigits = (s: string) => s.replace(/\D/g, '')

// 단건/일괄 공통: MemberCreateInput → 신규 리드 Member(기본값 동일 — 미배분·무료·정상·미아웃콜).
function buildLeadMember(
  input: MemberCreateInput,
  opts: { id: string; userId: string; staff: Staff | null; dup: boolean; imported?: boolean },
): Member {
  return {
    id: opts.id,
    user_id: input.user_id?.trim() || opts.userId,
    name: input.name.trim(),
    nickname: input.nickname?.trim() || null,
    phone: input.phone.trim(),
    grade: input.grade ?? 'free',
    status: 'active',
    tendency: input.tendency?.trim() || null,
    inflow_code: input.inflow_code?.trim() || null,
    inflow_type: input.inflow_type?.trim() || null,
    assigned_staff_id: opts.staff?.id ?? null,
    team_id: opts.staff?.team_id ?? null,
    memo: input.memo?.trim() || null,
    win_history: null,
    outcall_done: false,
    registered_at: nowIso(),
    last_active_at: null,
    is_suspended: false,
    is_deleted: false,
    is_withdrawn: false,
    meta: { ...(opts.dup ? { dup_phone: true } : {}), ...(opts.imported ? { imported: true } : {}) },
  }
}

// user_id(pl####) 자동 채번 시드: 기존 최대 번호.
function maxUserSeq(members: readonly { user_id: string }[]): number {
  return members.reduce((mx, m) => {
    const mm = /^pl(\d+)$/.exec(m.user_id)
    return mm ? Math.max(mx, parseInt(mm[1], 10)) : mx
  }, 1000)
}

/** 신규 리드 1건 등록. 미배분·무료·미아웃콜 기본. 전화 중복은 허용하고 meta.dup_phone 로 표시(중복유입). */
export function useCreateMember() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (input: MemberCreateInput) => {
      if (dataSource === 'supabase') return supa.createMember(input, user?.id ?? null)
      const id = genId('m')
      mutateDb((db) => {
        const phone = onlyDigits(input.phone)
        const dup = phone.length > 0 && db.members.some((m) => onlyDigits(m.phone) === phone)
        const staff = input.assigned_staff_id
          ? (db.staff.find((s) => s.id === input.assigned_staff_id) ?? null)
          : null
        const member = buildLeadMember(input, {
          id,
          userId: `pl${maxUserSeq(db.members) + 1}`,
          staff,
          dup,
        })
        db.members.push(member)
        if (staff) {
          db.assignments.push({
            id: genId('as'),
            member_id: id,
            staff_id: staff.id,
            assigned_by: user?.id ?? null,
            type: 'manual',
            created_at: nowIso(),
          })
        }
        db.logs.push(adminLog(user?.id ?? null, 'member.create', id, { name: member.name, dup }))
      })
      return id
    },
    onSuccess: (id) => invalidate([id]),
  })
}

/** 일괄 임포트(§V2-3) — 여러 리드를 한 번에 등록. 전화 중복 허용 + meta.dup_phone 표시(파일내·기존 모두 검사). */
export function useBulkImportMembers() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (inputs: MemberCreateInput[]) => {
      if (dataSource === 'supabase') return supa.bulkImportMembers(inputs, user?.id ?? null)
      let created = 0
      let dupCount = 0
      mutateDb((db) => {
        const phones = new Set(db.members.map((m) => onlyDigits(m.phone)).filter(Boolean))
        let seq = maxUserSeq(db.members)
        for (const input of inputs) {
          const phone = onlyDigits(input.phone)
          const dup = phone.length > 0 && phones.has(phone)
          if (dup) dupCount++
          if (phone) phones.add(phone)
          seq++
          const staff = input.assigned_staff_id
            ? (db.staff.find((s) => s.id === input.assigned_staff_id) ?? null)
            : null
          const id = genId('m')
          db.members.push(buildLeadMember(input, { id, userId: `pl${seq}`, staff, dup, imported: true }))
          if (staff) {
            db.assignments.push({
              id: genId('as'),
              member_id: id,
              staff_id: staff.id,
              assigned_by: user?.id ?? null,
              type: 'manual',
              created_at: nowIso(),
            })
          }
          created++
        }
        db.logs.push(adminLog(user?.id ?? null, 'member.bulk_import', null, { count: created, dup: dupCount }))
      })
      return { created, dup: dupCount }
    },
    onSuccess: () => invalidate(),
  })
}

/** 담당자 수동 배정. members.assigned_staff_id/team_id 갱신 + assignments 로그(§8). */
export function useAssignStaff() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[]; staffId: string }) => {
      if (dataSource === 'supabase') {
        await supa.assignStaff(v.ids, v.staffId, user?.id ?? null)
        return v.ids
      }
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

/**
 * 자동할당 — 라운드로빈. 풀 = 실행 시 지정한 staffIds(임시 가감) 우선,
 * 없으면 '자동배분 대상' 플래그가 켜진 활성 rep(§V2-1, assignableReps).
 */
export function useAutoAssign() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[]; staffIds?: string[] }) => {
      if (dataSource === 'supabase') {
        await supa.autoAssign(v.ids, v.staffIds ?? null, user?.id ?? null)
        return v.ids
      }
      const pool =
        v.staffIds && v.staffIds.length > 0
          ? readDb().staff.filter((s) => v.staffIds!.includes(s.id))
          : assignableReps()
      if (pool.length === 0) return v.ids
      mutateDb((db) => {
        const ts = nowIso()
        let i = 0
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          const rep = pool[i % pool.length]
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
          adminLog(user?.id ?? null, 'member.auto_assign', null, {
            count: v.ids.length,
            pool: pool.length,
          }),
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
      if (dataSource === 'supabase') {
        await supa.resetAssign(v.ids, user?.id ?? null)
        return v.ids
      }
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

// ── DB 초기화 (§V2-4) — 회원을 입력 시점(신규 리드) 상태로 되돌림 ───────────
export interface ResetMemo {
  body: string
  archived_at: string
  reset_by: string | null
}

/**
 * DB 초기화 — 재사용을 위해 회원을 신규 리드 상태로 되돌린다(차장 확정 옵션3).
 * 등급→무료·상태→정상·담당/팀 해제·아웃콜/성향/활동 초기화. 콜메모는 소프트삭제(meta.reset_memos)로
 * 보존해 최고관리자(admin)만 열람한다. 결제행은 감사용으로 보존(물리삭제 금지).
 */
export function useResetMembers() {
  const user = useCurrentUser()
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async (v: { ids: string[] }) => {
      if (dataSource === 'supabase') return supa.resetMembers(v.ids, user?.id ?? null)
      mutateDb((db) => {
        const ts = nowIso()
        for (const m of db.members) {
          if (!v.ids.includes(m.id)) continue
          const archive = ((m.meta?.reset_memos as ResetMemo[] | undefined) ?? []).slice()
          if (m.memo && m.memo.trim())
            archive.push({ body: m.memo, archived_at: ts, reset_by: user?.id ?? null })
          m.memo = null
          m.grade = 'free'
          m.status = 'active'
          m.assigned_staff_id = null
          m.team_id = null
          m.outcall_done = false
          m.tendency = null
          m.last_active_at = null
          m.is_suspended = false
          m.is_deleted = false
          m.is_withdrawn = false
          m.meta = { ...m.meta, reset_memos: archive, last_reset_at: ts }
          db.assignments.push({
            id: genId('as'),
            member_id: m.id,
            staff_id: null,
            assigned_by: user?.id ?? null,
            type: 'manual',
            created_at: ts,
          })
        }
        db.logs.push(adminLog(user?.id ?? null, 'member.reset_db', null, { count: v.ids.length }))
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
      if (dataSource === 'supabase') {
        await supa.sendSms(v.ids, v.templateKey, user?.id ?? null)
        return v.ids
      }
      // 본문 생성 + (광고성이면 (광고)·무료거부 자동표기). 실발송 설정 시 OneShot(Edge Function) 호출(§V2-6).
      const cur = readDb()
      const tpl = cur.sms_templates.find((t) => t.key === v.templateKey)
      const type = smsTypeForTemplate(v.templateKey)
      const sms = cur.site_settings.sms
      // 실발송: oneshot_enabled + 발신번호 설정 시. 실제 호출은 /api/send-sms(프록시) — 미배포 시 실패로 기록.
      const realSend = !!sms?.oneshot_enabled && !!sms.sender_no
      const targets = cur.members.filter((m) => v.ids.includes(m.id))
      const ts = nowIso()

      const records: SmsSend[] = []
      for (const m of targets) {
        let body = tpl ? renderSms(tpl.body, m) : ''
        if (type === 'marketing' && sms?.ad_optout) body = `(광고)${body}\n무료거부 ${sms.ad_optout}`
        let status = '발송완료'
        if (realSend) {
          const r = await sendOneShot({ dest_phone: m.phone, msg_body: body, send_phone: sms.sender_no })
          status = r.ok ? '발송완료' : '실패'
        }
        records.push({
          id: genId('sms'),
          member_id: m.id,
          template_key: v.templateKey,
          phone: m.phone,
          body,
          type,
          status,
          sent_at: ts,
        })
      }
      mutateDb((db) => {
        for (const rec of records) db.sms_sends.push(rec)
        db.logs.push({
          id: genId('log'),
          kind: 'sms',
          actor: user?.id ?? null,
          action: 'sms.send',
          target_type: 'member',
          target_id: null,
          meta: { count: records.length, template: v.templateKey, real: realSend },
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
