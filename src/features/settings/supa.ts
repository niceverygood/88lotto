// 설정(site_settings·sms_templates) — supabase 쓰기 경로 (M7). mock 의 mutateDb + adminLog 미러링.
// site_settings 는 단일행(id=1) 업데이트, sms_templates 는 key 기준 upsert.
// 읽기는 api.ts 가 fetchSiteSettings/fetchTables 로 분기(여기선 쓰기만).
import type { SiteSettings, SmsTemplate } from '@/types/db'
import { insertLog, sb } from '@/lib/db/remote'

/** 사이트 설정 전체 저장(단일행 id=1). 등급색 변경은 gradeTheme 가 토큰으로 전파(§3). */
export async function saveSiteSettings(next: SiteSettings, actor: string | null): Promise<void> {
  const { error } = await sb().from('site_settings').update({ ...next }).eq('id', 1)
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: 'settings.update',
    target_type: 'site_settings',
    target_id: null,
    meta: { pg: next.pg_providers.length },
  })
}

/** 문자 템플릿 일괄 저장(key 기준 upsert). members 쪽 useSmsTemplates 와 키 공유 → 함께 갱신(§8). */
export async function saveSmsTemplates(
  templates: SmsTemplate[],
  actor: string | null,
): Promise<void> {
  const { error } = await sb().from('sms_templates').upsert(templates, { onConflict: 'key' })
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: 'settings.sms_template',
    target_type: 'sms_template',
    target_id: null,
    meta: { keys: templates.map((t) => t.key) },
  })
}
