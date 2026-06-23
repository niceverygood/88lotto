// 라이브 Supabase 읽기/쓰기 공용 헬퍼 (M7). dataSource==='supabase' 일 때 mock readDb() 를
// 대체하는 비동기 스냅샷을 제공한다. RLS 가 역할 스코프를 적용하므로, 호출측 순수 변환
// (필터/정렬/집계)은 mock 과 동일 코드로 재사용된다(동작 동등성 보장 — 스코프 재적용은 멱등).
// nav_access(맵)·site_settings(단일행)는 mock 형태로 재구성한다.
// TODO(live-verify): 대량(15만)에서는 목록 조회를 server-side 필터/페이지네이션으로 이관해야 함.
import { type SupabaseClient } from '@supabase/supabase-js'
import type { LogKind, Role, SiteSettings } from '@/types/db'
import { supabase } from '@/lib/supabase'
import { DEFAULT_NAV_ACCESS, type NavAccessMap } from '@/lib/permissions'
import { genId, nowIso, type DbShape } from './store'

export function sb(): SupabaseClient {
  if (!supabase) throw new Error('supabase 클라이언트가 초기화되지 않았습니다.')
  return supabase
}

// 배열 테이블(테이블명 == DbShape 키). nav_access·site_settings 는 별도 형태.
type ArrayKey = Exclude<keyof DbShape, 'nav_access' | 'site_settings'>

// range 페이지네이션 코어. PostgREST 는 응답을 기본 1000행으로 캡하므로, 1000행 초과 테이블은
// 한 번의 select 로 전량을 못 가져온다(회차 1,227건·회원 1,985명 적재 후 발견 — 뒷부분이 잘림).
// build(from,to) 는 .range 가 적용된 새 쿼리를 반환해야 한다(필터·정렬은 build 안에서 부여).
// TODO(scale): 수만건+ 규모에선 server-side 필터/페이지네이션으로 이관 필요(현재는 클라 필터 구조).
export async function paginateAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const PAGE = 1000
  const out: T[] = []
  for (let from = 0; from < 500_000; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

/** 단일 테이블 전체 조회(RLS 스코프 자동 적용). 1000행 캡을 range 로 우회. */
export async function selectAll<T>(table: string): Promise<T[]> {
  return paginateAll<T>((from, to) => sb().from(table).select('*').range(from, to))
}

/** 여러 배열 테이블을 병렬 조회해 readDb()-호환 부분 스냅샷으로 반환. */
export async function fetchTables<K extends ArrayKey>(keys: readonly K[]): Promise<Pick<DbShape, K>> {
  const pairs = await Promise.all(
    keys.map(async (k) => [k, await selectAll<DbShape[K][number]>(k)] as const),
  )
  const out = {} as Pick<DbShape, K>
  for (const [k, rows] of pairs) out[k] = rows as DbShape[K]
  return out
}

/** 권한 매트릭스(nav_access) — 행을 맵으로 재구성. 비어있으면 기본값. */
export async function fetchNavAccess(): Promise<NavAccessMap> {
  const rows = await selectAll<{ nav_key: string; roles: Role[] }>('nav_access')
  if (rows.length === 0) return DEFAULT_NAV_ACCESS
  const out: NavAccessMap = {}
  for (const r of rows) out[r.nav_key] = r.roles
  return out
}

/** 사이트 설정(site_settings) — 단일행(id=1). 시드 선행 필요. */
export async function fetchSiteSettings(): Promise<SiteSettings> {
  const { data, error } = await sb().from('site_settings').select('*').eq('id', 1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('site_settings 행이 없습니다 — 시드를 먼저 적재하세요.')
  return data as SiteSettings
}

/** 로그 1건 적재(§8 감사). mock 의 db.logs.push 미러. */
export async function insertLog(row: {
  kind: LogKind
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
