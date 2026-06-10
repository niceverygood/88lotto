// Vercel 크론 함수 — 무료회원 주간 추천조합 자동발급(현장 피드백: 매주 금 09:00, 문자발송 X).
// vercel.json crons 가 매일 00:00 UTC(=09:00 KST) 호출 → 회원별 발송요일(meta.weekly_reco_day,
// 기본 금=5)이 '오늘(KST)'인 무료회원에게 발급한다. 멱등: 동일 회차 기발급 회원은 skip.
// 생성 로직은 운영콘솔과 동일(src/lib/lottoGenerator + 무료등급 고정/제외 규칙).
//
// Vercel 환경변수:
//   SUPABASE_URL(또는 VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY  ★필수(서버 전용 키)
//   CRON_SECRET  — 설정 시 Authorization: Bearer 검증(Vercel 크론이 자동 첨부)
// 수동 테스트: GET /api/weekly-reco?force=1  (요일 무시하고 즉시 발급)
import { createClient } from '@supabase/supabase-js'
import { generateRecommendation } from '../src/lib/lottoGenerator'
import { resolveExcludeForGrade } from '../src/lib/lotto'
import type { LottoRound, SiteSettings, WeeklyRecoIssue } from '../src/types/db'

const DEFAULT_DAY = 5 // 금요일(0=일..6=토)
const DEFAULT_COUNT = 30
const KEEP = 8

function kstNow(): Date {
  return new Date(Date.now() + 9 * 3600_000)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // Vercel 크론은 GET 으로 호출. CRON_SECRET 설정 시 Bearer 검증.
  const secret = process.env.CRON_SECRET
  if (secret && req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, code: 'AUTH' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return res.status(500).json({ ok: false, code: 'CONFIG', message: 'SUPABASE_URL/SERVICE_ROLE_KEY 미설정' })
  }
  const force = String(req.query?.force ?? '') === '1'
  const sb = createClient(url, key, { auth: { persistSession: false } })

  try {
    const kst = kstNow()
    const today = kst.getUTCDay() // KST 보정 후 UTC 요일 = KST 요일
    const ts = new Date().toISOString()

    const { data: sData, error: se } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle()
    if (se) throw se
    const settings = sData as SiteSettings
    const cfg = settings.weekly_free_reco ?? { enabled: true, set_count: DEFAULT_COUNT }
    if (!cfg.enabled && !force) {
      return res.status(200).json({ ok: true, skipped: 'disabled' })
    }

    const { data: rData, error: re } = await sb.from('lotto_rounds').select('*')
    if (re) throw re
    const rounds = (rData ?? []) as LottoRound[]
    const targetRound = rounds.reduce((mx, r) => Math.max(mx, r.round_no), 0) + 1
    const exclude = resolveExcludeForGrade(settings, 'free')
    const baseCount = Math.max(1, cfg.set_count || DEFAULT_COUNT)

    const { data: mData, error: me } = await sb
      .from('members')
      .select('id, meta')
      .eq('grade', 'free')
      .eq('is_deleted', false)
      .eq('is_withdrawn', false)
    if (me) throw me
    const rows = (mData ?? []) as { id: string; meta: Record<string, unknown> | null }[]

    let issued = 0
    let skippedRound = 0
    let skippedDay = 0
    for (const r of rows) {
      const meta = r.meta ?? {}
      const day = typeof meta.weekly_reco_day === 'number' ? (meta.weekly_reco_day as number) : DEFAULT_DAY
      if (!force && day !== today) {
        skippedDay++
        continue
      }
      const recos = Array.isArray(meta.weekly_recos) ? (meta.weekly_recos as WeeklyRecoIssue[]) : []
      if (recos[0]?.round_no === targetRound) {
        skippedRound++
        continue
      }
      const count =
        typeof meta.weekly_reco_count === 'number' && (meta.weekly_reco_count as number) > 0
          ? (meta.weekly_reco_count as number)
          : baseCount
      const gen = generateRecommendation(rounds, exclude, { mode: 20, setCount: count })
      const issue: WeeklyRecoIssue = { round_no: targetRound, issued_at: ts, sets: gen.sets }
      const nextMeta = { ...meta, weekly_recos: [issue, ...recos].slice(0, KEEP) }
      const { error } = await sb.from('members').update({ meta: nextMeta }).eq('id', r.id)
      if (error) throw error
      issued++
    }

    await sb.from('logs').insert({
      id: `log_cron_${Date.now().toString(36)}`,
      kind: 'admin',
      actor: null,
      action: 'reco.weekly_issue',
      target_type: 'member',
      target_id: null,
      meta: { count: issued, skipped: skippedRound, skipped_day: skippedDay, round_no: targetRound, channel: 'cron', force },
      created_at: ts,
    })

    return res.status(200).json({ ok: true, round_no: targetRound, issued, skippedRound, skippedDay })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ ok: false, code: 'ERROR', message })
  }
}
