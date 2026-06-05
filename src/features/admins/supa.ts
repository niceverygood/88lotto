// 관리자(운영자 계정·권한 매트릭스) — supabase 쓰기 경로 (M7). mock 의 mutateDb + adminLog 미러링.
// staff 는 소규모(운영자) 테이블이라 중복 login_id 검사는 전체 조회 후 JS 비교로 mock 과 동일하게 처리.
// nav_access 는 행(nav_key→roles)으로 영속 → 맵을 upsert 한다(remote.fetchNavAccess 와 대칭).
// TODO(live-verify): 라이브 운영자 생성은 Supabase auth.users 연결(auth_user_id)이 별도로 필요.
import type { Role, Staff } from '@/types/db'
import { genId } from '@/lib/db/store'
import { insertLog, sb } from '@/lib/db/remote'
import type { NavAccessMap } from '@/lib/permissions'
import type { StaffInput } from './api'

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
