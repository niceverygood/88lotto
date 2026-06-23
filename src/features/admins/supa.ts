// 관리자(운영자 계정·권한 매트릭스) — supabase 쓰기 경로 (M7). mock 의 mutateDb + adminLog 미러링.
// staff 는 소규모(운영자) 테이블이라 중복 login_id 검사는 전체 조회 후 JS 비교로 mock 과 동일하게 처리.
// nav_access 는 행(nav_key→roles)으로 영속 → 맵을 upsert 한다(remote.fetchNavAccess 와 대칭).
// TODO(live-verify): 라이브 운영자 생성은 Supabase auth.users 연결(auth_user_id)이 별도로 필요.
import type { Role, Staff } from '@/types/db'
import { genId } from '@/lib/db/store'
import { insertLog, sb } from '@/lib/db/remote'
import type { NavAccessMap } from '@/lib/permissions'
import { tallyTodayDb, type StaffInput, type TodayDbCount } from './api'

/** 금일(오늘 0시~) 배정 이력을 staff 별 {전체/수동/자동} 으로 집계. */
export async function fetchTodayDbCounts(): Promise<Record<string, TodayDbCount>> {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const { data, error } = await sb()
    .from('assignments')
    .select('staff_id, type, created_at')
    .gte('created_at', start.toISOString())
  if (error) throw error
  return tallyTodayDb(
    (data ?? []) as { staff_id: string | null; type: 'manual' | 'auto'; created_at: string }[],
  )
}

// 운영자 Auth 비밀번호 설정/생성 — 서버 함수(/api/staff-set-password, service_role) 호출.
// login_id 기준으로 Auth 유저를 보장(없으면 생성·있으면 비번변경)하고 staff.auth_user_id 링크.
// 최고관리자만 호출 가능(서버에서 access token 으로 재검증). 현장 피드백 6/23.
export async function setStaffPassword(login_id: string, password: string): Promise<void> {
  const { data } = await sb().auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('세션이 만료되었습니다. 다시 로그인해주세요.')
  const r = await fetch('/api/staff-set-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ login_id, password }),
  })
  const j = (await r.json().catch(() => ({}))) as { ok?: boolean; message?: string }
  if (!r.ok || !j.ok) throw new Error(j.message || `비밀번호 설정 실패 (${r.status})`)
}

/** 운영자 계정 생성/수정. login_id 중복은 거부(throw). 반환=staff id. */
export async function saveStaff(
  v: { id?: string; input: StaffInput },
  actor: string | null,
): Promise<string> {
  const login = v.input.login_id.trim()
  const { data: all, error: le } = await sb().from('staff').select('id, login_id')
  if (le) throw le
  const dup = ((all ?? []) as { id: string; login_id: string }[]).find(
    (s) => s.login_id.toLowerCase() === login.toLowerCase() && s.id !== v.id,
  )
  if (dup) throw new Error('이미 사용 중인 로그인 ID 입니다.')

  const name = v.input.name.trim()
  // admin 은 팀 소속 없음(전체 관리).
  const team_id = v.input.role === 'admin' ? null : v.input.team_id
  if (v.id) {
    const { error } = await sb()
      .from('staff')
      .update({ name, login_id: login, role: v.input.role, team_id, is_active: v.input.is_active, auto_assign_enabled: v.input.auto_assign_enabled })
      .eq('id', v.id)
    if (error) throw error
    await insertLog({
      kind: 'admin',
      actor,
      action: 'staff.update',
      target_type: 'staff',
      target_id: v.id,
      meta: { name, role: v.input.role },
    })
    return v.id
  }
  const id = genId('staff')
  const row: Staff = {
    id,
    login_id: login,
    name,
    role: v.input.role,
    team_id,
    is_active: v.input.is_active,
    auto_assign_enabled: v.input.auto_assign_enabled,
    last_login_at: null,
  }
  const { error } = await sb().from('staff').insert(row)
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: 'staff.create',
    target_type: 'staff',
    target_id: id,
    meta: { name, role: v.input.role, login_id: login },
  })
  return id
}

/** 계정 활성/비활성 토글. */
export async function toggleStaffActive(
  id: string,
  active: boolean,
  actor: string | null,
): Promise<string> {
  const { data } = await sb().from('staff').select('name').eq('id', id).maybeSingle()
  const name = (data as { name: string } | null)?.name ?? ''
  const { error } = await sb().from('staff').update({ is_active: active }).eq('id', id)
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: active ? 'staff.activate' : 'staff.deactivate',
    target_type: 'staff',
    target_id: id,
    meta: { name },
  })
  return id
}

/** 권한 매트릭스 저장 → 사이드바/가드 즉시 반영(§8). 맵의 각 nav_key 행을 upsert. */
export async function saveNavAccess(map: NavAccessMap, actor: string | null): Promise<void> {
  const rows = Object.entries(map).map(([nav_key, roles]) => ({ nav_key, roles: [...roles] as Role[] }))
  const { error } = await sb().from('nav_access').upsert(rows, { onConflict: 'nav_key' })
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: 'roles.update',
    target_type: 'nav_access',
    target_id: null,
    meta: { modules: rows.length },
  })
}
