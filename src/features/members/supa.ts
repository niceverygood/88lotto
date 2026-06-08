// 이용자 모듈 — supabase 데이터 경로 (M6). dataSource==='supabase' 일 때 api.ts 가 호출.
// 설계: 읽기는 RLS 가 역할 스코프를 처리하므로 "조회만" 하고, 뷰/필터/정렬/페이지는
//       api.ts 의 공유 순수함수(listFrom/countsFrom)가 그대로 적용한다(=mock 과 동일 동작).
//       쓰기는 mock 의 mutateDb 부수효과(§8)를 supabase 호출로 1:1 미러링한다.
// TODO(live-verify): 대량(15만) 데이터에서는 목록을 server-side 필터/페이지네이션으로 이관해야 함.
import { type SupabaseClient } from '@supabase/supabase-js'
import type { Assignment, Member, MemberStatus, Payment, Product, Role, SmsSend, SmsTemplate } from '@/types/db'
import { supabase } from '@/lib/supabase'
import { genId, nowIso } from '@/lib/db/store'
import { renderSms, smsTypeForTemplate } from '@/lib/sms'
import type { MemberCreateInput, MemberPatch, MySmsRow } from './api'

function sb(): SupabaseClient {
  if (!supabase) throw new Error('supabase 클라이언트가 초기화되지 않았습니다.')
  return supabase
}

// 상태 변경 시 파생 불리언 플래그(스키마 컬럼)를 함께 갱신.
function statusFlags(status: MemberStatus | undefined): Record<string, unknown> {
  if (!status) return {}
  return {
    is_suspended: status === 'suspended',
    is_deleted: status === 'deleted',
    is_withdrawn: status === 'withdrawn',
  }
}

async function pushLog(row: {
  kind: 'admin' | 'sms'
  actor: string | null
  action: string
  target_type?: string | null
  target_id?: string | null
  meta?: Record<string, unknown>
}): Promise<void> {
  const { error } = await sb()
    .from('logs')
    .insert({
      id: genId('log'),
      kind: row.kind,
      actor: row.actor,
      action: row.action,
      target_type: row.target_type ?? null,
      target_id: row.target_id ?? null,
      meta: row.meta ?? {},
      created_at: nowIso(),
    })
  if (error) throw error
}

// ── 읽기 ──────────────────────────────────────────────────────────────────
/** 역할 스코프된 전체 회원(RLS 적용). 뷰/필터/정렬/페이지는 호출측 listFrom 이 처리. */
export async function fetchScopedMembers(): Promise<Member[]> {
  const { data, error } = await sb().from('members').select('*')
  if (error) throw error
  return (data ?? []) as Member[]
}

/** 내가 담당하는 회원만(나의고객). RLS 가시성 내에서 assigned_staff_id=uid 로 한정. */
export async function fetchMineMembers(uid: string): Promise<Member[]> {
  if (!uid) return []
  const { data, error } = await sb().from('members').select('*').eq('assigned_staff_id', uid)
  if (error) throw error
  return (data ?? []) as Member[]
}

/** assigned_staff_id → role 매핑(필터 ctx 용). roleScope 뷰(실장/팀장담당)가 사용. */
export async function fetchStaffRoleMap(): Promise<Record<string, Role>> {
  const { data, error } = await sb().from('staff').select('id, role')
  if (error) throw error
  const out: Record<string, Role> = {}
  for (const s of (data ?? []) as { id: string; role: Role }[]) out[s.id] = s.role
  return out
}

export async function fetchMember(id: string): Promise<Member | null> {
  const { data, error } = await sb().from('members').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return (data as Member | null) ?? null
}

export async function fetchMemberPayments(id: string): Promise<Payment[]> {
  const { data, error } = await sb().from('payments').select('*').eq('member_id', id)
  if (error) throw error
  return (data ?? []) as Payment[]
}

export async function fetchMemberSms(id: string): Promise<SmsSend[]> {
  const { data, error } = await sb().from('sms_sends').select('*').eq('member_id', id)
  if (error) throw error
  return (data ?? []) as SmsSend[]
}

export async function fetchMemberAssignments(id: string): Promise<Assignment[]> {
  const { data, error } = await sb().from('assignments').select('*').eq('member_id', id)
  if (error) throw error
  return (data ?? []) as Assignment[]
}

export async function fetchSmsTemplates(): Promise<SmsTemplate[]> {
  const { data, error } = await sb().from('sms_templates').select('*')
  if (error) throw error
  return (data ?? []) as SmsTemplate[]
}

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await sb().from('products').select('*')
  if (error) throw error
  return (data ?? []) as Product[]
}

/** 내 담당 회원에게 발송된 문자 내역(최신순). */
export async function fetchMineSmsLog(uid: string, limit: number): Promise<MySmsRow[]> {
  if (!uid) return []
  const { data: mem, error: me } = await sb().from('members').select('id, name').eq('assigned_staff_id', uid)
  if (me) throw me
  const nameById = new Map((mem ?? []).map((m) => [(m as { id: string }).id, (m as { name: string }).name]))
  const ids = [...nameById.keys()]
  if (ids.length === 0) return []
  const { data: sms, error: se } = await sb()
    .from('sms_sends')
    .select('*')
    .in('member_id', ids)
    .order('sent_at', { ascending: false })
    .limit(limit)
  if (se) throw se
  return ((sms ?? []) as SmsSend[]).map((s) => ({
    id: s.id,
    member_id: s.member_id,
    member_name: nameById.get(s.member_id) ?? s.member_id,
    phone: s.phone,
    body: s.body,
    type: s.type,
    status: s.status,
    sent_at: s.sent_at,
  }))
}

// ── 쓰기 (§8 미러링) ───────────────────────────────────────────────────────
/** 회원 단건 등록(§V2-2) — mock useCreateMember 의 supabase 미러. 전화 중복 허용(meta.dup_phone). */
export async function createMember(input: MemberCreateInput, actor: string | null): Promise<string> {
  const id = genId('m')
  const digits = (s: string) => s.replace(/\D/g, '')
  const { data: existing } = await sb().from('members').select('phone, user_id')
  const rows = (existing ?? []) as { phone: string; user_id: string }[]
  const phone = digits(input.phone)
  const dup = phone.length > 0 && rows.some((m) => digits(m.phone) === phone)
  const maxNum = rows.reduce((mx, m) => {
    const mm = /^pl(\d+)$/.exec(m.user_id ?? '')
    return mm ? Math.max(mx, parseInt(mm[1], 10)) : mx
  }, 1000)
  let staff: { id: string; team_id: string | null } | null = null
  if (input.assigned_staff_id) {
    const { data } = await sb()
      .from('staff')
      .select('id, team_id')
      .eq('id', input.assigned_staff_id)
      .maybeSingle()
    staff = (data as { id: string; team_id: string | null } | null) ?? null
  }
  const row: Member = {
    id,
    user_id: input.user_id?.trim() || `pl${maxNum + 1}`,
    name: input.name.trim(),
    nickname: input.nickname?.trim() || null,
    phone: input.phone.trim(),
    grade: input.grade ?? 'free',
    status: 'active',
    tendency: input.tendency?.trim() || null,
    inflow_code: input.inflow_code?.trim() || null,
    inflow_type: input.inflow_type?.trim() || null,
    assigned_staff_id: staff?.id ?? null,
    team_id: staff?.team_id ?? null,
    memo: input.memo?.trim() || null,
    win_history: null,
    outcall_done: false,
    registered_at: nowIso(),
    last_active_at: null,
    is_suspended: false,
    is_deleted: false,
    is_withdrawn: false,
    meta: dup ? { dup_phone: true } : {},
  }
  const { error } = await sb().from('members').insert(row)
  if (error) throw error
  if (staff) {
    await sb().from('assignments').insert({
      id: genId('as'),
      member_id: id,
      staff_id: staff.id,
      assigned_by: actor,
      type: 'manual',
      created_at: nowIso(),
    })
  }
  await pushLog({
    kind: 'admin',
    actor,
    action: 'member.create',
    target_type: 'member',
    target_id: id,
    meta: { name: row.name, dup },
  })
  return id
}

/** 일괄 임포트(§V2-3) — mock useBulkImportMembers 의 supabase 미러. 청크 분할 insert. */
export async function bulkImportMembers(
  inputs: MemberCreateInput[],
  actor: string | null,
): Promise<{ created: number; dup: number }> {
  const digits = (s: string) => s.replace(/\D/g, '')
  const { data: existing } = await sb().from('members').select('phone, user_id')
  const rows = (existing ?? []) as { phone: string; user_id: string }[]
  const phones = new Set(rows.map((m) => digits(m.phone)).filter(Boolean))
  let seq = rows.reduce((mx, m) => {
    const mm = /^pl(\d+)$/.exec(m.user_id ?? '')
    return mm ? Math.max(mx, parseInt(mm[1], 10)) : mx
  }, 1000)
  const staffIds = [...new Set(inputs.map((i) => i.assigned_staff_id).filter(Boolean) as string[])]
  const staffTeam = new Map<string, string | null>()
  if (staffIds.length) {
    const { data } = await sb().from('staff').select('id, team_id').in('id', staffIds)
    for (const s of (data ?? []) as { id: string; team_id: string | null }[]) staffTeam.set(s.id, s.team_id)
  }
  const memberRows: Member[] = []
  const assignmentRows: Record<string, unknown>[] = []
  let dup = 0
  const ts = nowIso()
  for (const input of inputs) {
    const phone = digits(input.phone)
    const isDup = phone.length > 0 && phones.has(phone)
    if (isDup) dup++
    if (phone) phones.add(phone)
    seq++
    const id = genId('m')
    const sid = input.assigned_staff_id ?? null
    const team = sid ? (staffTeam.get(sid) ?? null) : null
    memberRows.push({
      id,
      user_id: input.user_id?.trim() || `pl${seq}`,
      name: input.name.trim(),
      nickname: input.nickname?.trim() || null,
      phone: input.phone.trim(),
      grade: input.grade ?? 'free',
      status: 'active',
      tendency: input.tendency?.trim() || null,
      inflow_code: input.inflow_code?.trim() || null,
      inflow_type: input.inflow_type?.trim() || null,
      assigned_staff_id: sid,
      team_id: team,
      memo: input.memo?.trim() || null,
      win_history: null,
      outcall_done: false,
      registered_at: ts,
      last_active_at: null,
      is_suspended: false,
      is_deleted: false,
      is_withdrawn: false,
      meta: { imported: true, ...(isDup ? { dup_phone: true } : {}) },
    })
    if (sid) {
      assignmentRows.push({
        id: genId('as'),
        member_id: id,
        staff_id: sid,
        assigned_by: actor,
        type: 'manual',
        created_at: ts,
      })
    }
  }
  const CHUNK = 500
  for (let i = 0; i < memberRows.length; i += CHUNK) {
    const { error } = await sb().from('members').insert(memberRows.slice(i, i + CHUNK))
    if (error) throw error
  }
  for (let i = 0; i < assignmentRows.length; i += CHUNK) {
    const { error } = await sb().from('assignments').insert(assignmentRows.slice(i, i + CHUNK))
    if (error) throw error
  }
  await pushLog({
    kind: 'admin',
    actor,
    action: 'member.bulk_import',
    target_type: 'member',
    target_id: null,
    meta: { count: memberRows.length, dup },
  })
  return { created: memberRows.length, dup }
}

export async function updateMember(id: string, patch: MemberPatch, actor: string | null): Promise<void> {
  const { data: cur } = await sb().from('members').select('grade, status').eq('id', id).maybeSingle()
  const before = cur ? { grade: (cur as Member).grade, status: (cur as Member).status } : {}
  const { error } = await sb()
    .from('members')
    .update({ ...patch, ...statusFlags(patch.status) })
    .eq('id', id)
  if (error) throw error
  await pushLog({ kind: 'admin', actor, action: 'member.update', target_type: 'member', target_id: id, meta: { patch, before } })
}

/** 콜메모 1건 append(리스트형). meta.memos 에 누적하고 members.memo(최신)를 동기화. */
export async function addMemo(id: string, body: string, actor: string | null): Promise<void> {
  const { data: cur } = await sb().from('members').select('meta').eq('id', id).maybeSingle()
  const meta = ((cur as { meta: Record<string, unknown> } | null)?.meta ?? {}) as Record<string, unknown>
  const list = Array.isArray(meta.memos) ? (meta.memos as unknown[]) : []
  const entry = { id: genId('memo'), body, author: actor, created_at: nowIso() }
  const nextMeta = { ...meta, memos: [...list, entry] }
  const { error } = await sb().from('members').update({ meta: nextMeta, memo: body }).eq('id', id)
  if (error) throw error
  await pushLog({ kind: 'admin', actor, action: 'member.memo_add', target_type: 'member', target_id: id, meta: { body } })
}

export async function bulkUpdateMembers(
  ids: string[],
  patch: MemberPatch & { inflow_type?: string },
  actor: string | null,
): Promise<void> {
  const { error } = await sb()
    .from('members')
    .update({ ...patch, ...statusFlags(patch.status) })
    .in('id', ids)
  if (error) throw error
  await pushLog({ kind: 'admin', actor, action: 'member.bulk_update', meta: { count: ids.length, ids, patch } })
}

export async function assignStaff(ids: string[], staffId: string, actor: string | null): Promise<void> {
  const { data: st } = await sb().from('staff').select('team_id').eq('id', staffId).maybeSingle()
  const teamId = (st as { team_id: string | null } | null)?.team_id ?? null
  const { error: e1 } = await sb().from('members').update({ assigned_staff_id: staffId, team_id: teamId }).in('id', ids)
  if (e1) throw e1
  const ts = nowIso()
  const rows = ids.map((mid) => ({
    id: genId('as'),
    member_id: mid,
    staff_id: staffId,
    assigned_by: actor,
    type: 'manual' as const,
    created_at: ts,
  }))
  const { error: e2 } = await sb().from('assignments').insert(rows)
  if (e2) throw e2
  await pushLog({ kind: 'admin', actor, action: 'member.assign', meta: { count: ids.length, staff_id: staffId } })
}

export async function autoAssign(
  ids: string[],
  staffIds: string[] | null,
  actor: string | null,
): Promise<void> {
  // 풀: 실행 시 지정 staffIds 우선, 없으면 '자동배분 대상' 플래그 rep(§V2-1).
  let q = sb().from('staff').select('id, team_id')
  q =
    staffIds && staffIds.length > 0
      ? q.in('id', staffIds)
      : q.eq('role', 'rep').eq('is_active', true).eq('auto_assign_enabled', true)
  const { data: repData, error: re } = await q
  if (re) throw re
  const reps = (repData ?? []) as { id: string; team_id: string | null }[]
  if (reps.length === 0) return
  const ts = nowIso()
  const asg: Record<string, unknown>[] = []
  let i = 0
  // TODO(live-verify): rep 순서 결정성 — 라이브에서는 order by 로 고정 권장.
  for (const mid of ids) {
    const rep = reps[i % reps.length]
    i++
    const { error } = await sb().from('members').update({ assigned_staff_id: rep.id, team_id: rep.team_id }).eq('id', mid)
    if (error) throw error
    asg.push({ id: genId('as'), member_id: mid, staff_id: rep.id, assigned_by: actor, type: 'auto', created_at: ts })
  }
  const { error: e2 } = await sb().from('assignments').insert(asg)
  if (e2) throw e2
  await pushLog({ kind: 'admin', actor, action: 'member.auto_assign', meta: { count: ids.length } })
}

export async function resetAssign(ids: string[], actor: string | null): Promise<void> {
  const { error: e1 } = await sb().from('members').update({ assigned_staff_id: null, team_id: null }).in('id', ids)
  if (e1) throw e1
  const ts = nowIso()
  const rows = ids.map((mid) => ({
    id: genId('as'),
    member_id: mid,
    staff_id: null,
    assigned_by: actor,
    type: 'manual' as const,
    created_at: ts,
  }))
  const { error: e2 } = await sb().from('assignments').insert(rows)
  if (e2) throw e2
  await pushLog({ kind: 'admin', actor, action: 'member.reset_assign', meta: { count: ids.length } })
}

/** DB 초기화(§V2-4) — mock useResetMembers 의 supabase 미러. 콜메모 소프트삭제(meta.reset_memos) 보존. */
export async function resetMembers(ids: string[], actor: string | null): Promise<string[]> {
  const ts = nowIso()
  const { data } = await sb().from('members').select('id, memo, meta').in('id', ids)
  const rows = (data ?? []) as { id: string; memo: string | null; meta: Record<string, unknown> | null }[]
  for (const r of rows) {
    const archive = (((r.meta?.reset_memos as unknown[] | undefined) ?? []) as unknown[]).slice()
    // 리스트형 콜메모 전체 보존 후 비움. 없으면 단건 메모 폴백.
    const memos = Array.isArray(r.meta?.memos) ? (r.meta!.memos as { body: string }[]) : []
    if (memos.length > 0) {
      for (const e of memos) archive.push({ body: e.body, archived_at: ts, reset_by: actor })
    } else if (r.memo && r.memo.trim()) {
      archive.push({ body: r.memo, archived_at: ts, reset_by: actor })
    }
    const meta = { ...(r.meta ?? {}), memos: [], reset_memos: archive, last_reset_at: ts }
    const { error } = await sb()
      .from('members')
      .update({
        memo: null,
        grade: 'free',
        status: 'active',
        assigned_staff_id: null,
        team_id: null,
        outcall_done: false,
        tendency: null,
        last_active_at: null,
        registered_at: ts, // 현장 피드백: 초기화 시점을 새 가입일시로
        is_suspended: false,
        is_deleted: false,
        is_withdrawn: false,
        meta,
      })
      .eq('id', r.id)
    if (error) throw error
  }
  const asg = ids.map((id) => ({
    id: genId('as'),
    member_id: id,
    staff_id: null,
    assigned_by: actor,
    type: 'manual' as const,
    created_at: ts,
  }))
  if (asg.length) {
    const { error } = await sb().from('assignments').insert(asg)
    if (error) throw error
  }
  await pushLog({ kind: 'admin', actor, action: 'member.reset_db', target_type: 'member', target_id: null, meta: { count: ids.length } })
  return ids
}

export async function sendSms(ids: string[], templateKey: string, actor: string | null): Promise<void> {
  const { data: tplData } = await sb().from('sms_templates').select('*').eq('key', templateKey).maybeSingle()
  const tpl = tplData as SmsTemplate | null
  const { data: memData, error: me } = await sb().from('members').select('*').in('id', ids)
  if (me) throw me
  const members = (memData ?? []) as Member[]
  const ts = nowIso()
  const type = smsTypeForTemplate(templateKey)
  const rows = members.map((m) => ({
    id: genId('sms'),
    member_id: m.id,
    template_key: templateKey,
    phone: m.phone,
    body: tpl ? renderSms(tpl.body, m) : '',
    type,
    status: '발송완료',
    sent_at: ts,
  }))
  const { error: e2 } = await sb().from('sms_sends').insert(rows)
  if (e2) throw e2
  await pushLog({ kind: 'sms', actor, action: 'sms.send', target_type: 'member', target_id: null, meta: { count: ids.length, template: templateKey } })
}
