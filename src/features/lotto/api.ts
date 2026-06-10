// 로또기록 모듈 데이터 훅 (CLAUDE §1·§8, BUILD_PROMPTS Phase 6 — 스샷 있음, 원본 구조 재현).
// 회차/베팅은 전역 데이터(역할 스코프 없음). '당첨 확정'은 회차 베팅의 등수/당첨금을 산정하고
// 1~3등 당첨자의 win_history 를 갱신(§8 당첨자 세그먼트) → lotto/bets/members 쿼리 무효화.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Bet, Grade, LogEntry, LottoExcludeRule, LottoExcludeSettings, LottoRound, SiteSettings, WeeklyRecoIssue } from '@/types/db'
import { genId, mutateDb, nowIso, readDb } from '@/lib/db/store'
import { dataSource } from '@/lib/supabase'
import { fetchSiteSettings, fetchTables } from '@/lib/db/remote'
import { useCurrentUser } from '@/lib/auth'
import { betKeys, lottoKeys, memberKeys, settingsKeys } from '@/lib/queryKeys'
import { gradeRank, lottoSum, oddEven, prizeForRank } from '@/lib/lotto'
import { generateRecommendation } from '@/lib/lottoGenerator'
import * as supa from './supa'

export const WEEKLY_FREE_RECO_DEFAULT = { enabled: true, set_count: 30 }
const WEEKLY_RECO_KEEP = 8 // 회원당 보관할 최근 발급 회차 수
// 회원별 결정적 시드(같은 회원·회차는 동일 결과, 회원마다 다른 조합).
function memberSeed(id: string, round: number): number {
  let h = round * 2654435761
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h >>> 0
}

export interface RoundRow extends LottoRound {
  betCount: number
  winnerCount: number // 등수 있는 베팅 수(확정 회차)
  prizeSum: number // 당첨금 합계
}

export type RoundFilter = 'all' | 'confirmed' | 'pending'

function aggregateBets(bets: readonly Bet[]): Map<number, { count: number; winners: number; prize: number }> {
  const m = new Map<number, { count: number; winners: number; prize: number }>()
  for (const b of bets) {
    const cur = m.get(b.round_no) ?? { count: 0, winners: 0, prize: 0 }
    cur.count += 1
    if (b.rank != null) cur.winners += 1
    cur.prize += b.prize ?? 0
    m.set(b.round_no, cur)
  }
  return m
}

/** 회차 목록(최신순). 확정/미확정 필터. 베팅 집계 동봉. */
export function useRounds(filter: RoundFilter = 'all') {
  return useQuery({
    queryKey: lottoKeys.rounds({ filter }),
    queryFn: async (): Promise<RoundRow[]> => {
      const db =
        dataSource === 'supabase' ? await fetchTables(['bets', 'lotto_rounds']) : readDb()
      const agg = aggregateBets(db.bets)
      let rows = db.lotto_rounds.map((r): RoundRow => {
        const a = agg.get(r.round_no)
        return {
          ...r,
          betCount: a?.count ?? 0,
          winnerCount: a?.winners ?? 0,
          prizeSum: a?.prize ?? 0,
        }
      })
      if (filter === 'confirmed') rows = rows.filter((r) => r.confirmed_at != null)
      else if (filter === 'pending') rows = rows.filter((r) => r.confirmed_at == null)
      return rows.sort((a, b) => b.round_no - a.round_no)
    },
    placeholderData: (prev) => prev,
  })
}

/**
 * 추천 생성기용 수동 고정·제외 설정. settings 페이지의 useSiteSettings 와 동일 쿼리 키를
 * 공유하므로(설정 캐시 재사용) 설정 편집이 추천 화면에 즉시 반영된다(§2 feature 간 import 회피).
 */
function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 등급별 활성 고정/제외 규칙 = effective_from<=오늘 중 가장 최근. 해당 등급 규칙이 없으면
// 공통(grade=null) → 그것도 없으면 레거시 lotto_exclude 스냅샷으로 폴백(현장 피드백).
export function resolveExcludeForGrade(
  settings: Pick<SiteSettings, 'lotto_exclude' | 'lotto_exclude_history'>,
  grade: Grade | null,
): LottoExcludeSettings {
  const today = todayStr()
  const effective = (settings.lotto_exclude_history ?? [])
    .filter((r) => r.effective_from <= today)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.round_no - a.round_no)
  const pick = (g: Grade | null): LottoExcludeRule | undefined =>
    effective.find((r) => (r.grade ?? null) === g)
  const rule = (grade != null ? pick(grade) : undefined) ?? pick(null)
  return rule ? { fixed: rule.fixed, excluded: rule.excluded } : settings.lotto_exclude
}

// 추천 생성용 사이트 설정(고정/제외 이력 포함). 등급 해석은 resolveExcludeForGrade 로 호출측에서 수행.
export function useLottoExclude() {
  return useQuery({
    queryKey: settingsKeys.site(),
    queryFn: async (): Promise<SiteSettings> =>
      dataSource === 'supabase' ? await fetchSiteSettings() : readDb().site_settings,
  })
}

function lottoLog(actor: string | null, action: string, roundNo: number, meta: Record<string, unknown>): LogEntry {
  return {
    id: genId('log'),
    kind: 'admin',
    actor,
    action,
    target_type: 'lotto_round',
    target_id: String(roundNo),
    meta,
    created_at: nowIso(),
  }
}

/**
 * 당첨 확정: 해당 회차 모든 베팅의 등수/당첨금을 (재)산정하고 confirmed_at 기록.
 * §8: 1~3등 당첨 베팅의 연결 회원 win_history 갱신(당첨자 세그먼트). 멱등(재확정 가능).
 */
export function useConfirmRound() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: { roundNo: number }) => {
      if (dataSource === 'supabase') return supa.confirmRound(v.roundNo, user?.id ?? null)
      mutateDb((db) => {
        const round = db.lotto_rounds.find((r) => r.round_no === v.roundNo)
        if (!round) return
        let winners = 0
        let prizeSum = 0
        for (const bet of db.bets) {
          if (bet.round_no !== v.roundNo) continue
          const rank = gradeRank(bet.numbers, round.numbers, round.bonus)
          bet.rank = rank
          bet.prize = prizeForRank(round, rank)
          if (rank != null) {
            winners += 1
            prizeSum += bet.prize ?? 0
          }
          if (rank != null && rank <= 3 && bet.member_ref) {
            const m = db.members.find((x) => x.id === bet.member_ref)
            if (m) m.win_history = `${v.roundNo}회 ${rank}등`
          }
        }
        round.confirmed_at = nowIso()
        db.logs.push(lottoLog(user?.id ?? null, 'lotto.confirm', v.roundNo, { winners, prizeSum }))
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lottoKeys.all })
      qc.invalidateQueries({ queryKey: betKeys.all })
      qc.invalidateQueries({ queryKey: memberKeys.all }) // 당첨자 세그먼트 재계산(§8)
    },
  })
}

export interface RegisterRoundInput {
  round_no: number
  draw_date: string // yyyy-MM-dd
  numbers: number[] // 6
  bonus: number
  prize_1: number | null
  prize_2: number | null
  prize_3: number | null
  total_sales: number | null
}

export type RegisterResult = { ok: true } | { ok: false; error: string }

/** 회차 등록(당첨번호 입력). 미확정 상태로 추가 → 이후 '당첨 확정'으로 베팅 채점. */
export function useRegisterRound() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (v: RegisterRoundInput): Promise<RegisterResult> => {
      if (dataSource === 'supabase') return supa.registerRound(v, user?.id ?? null)
      let result: RegisterResult = { ok: true }
      mutateDb((db) => {
        if (db.lotto_rounds.some((r) => r.round_no === v.round_no)) {
          result = { ok: false, error: '이미 존재하는 회차입니다.' }
          return
        }
        const round: LottoRound = {
          round_no: v.round_no,
          draw_date: new Date(`${v.draw_date}T20:45:00+09:00`).toISOString(),
          numbers: [...v.numbers].sort((a, b) => a - b),
          bonus: v.bonus,
          sum: lottoSum(v.numbers),
          odd_even: oddEven(v.numbers),
          appear_rate: null,
          prize_1: v.prize_1,
          prize_2: v.prize_2,
          prize_3: v.prize_3,
          total_sales: v.total_sales,
          confirmed_at: null,
        }
        db.lotto_rounds.push(round)
        db.logs.push(lottoLog(user?.id ?? null, 'lotto.register', v.round_no, { numbers: round.numbers, bonus: round.bonus }))
      })
      return result
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: lottoKeys.all })
    },
  })
}

// ── 무료회원 주간 자동발급(현장 피드백) ─────────────────────────────────────
// 매주 금 09:00, 무료회원에게 N(기본 30)조합 발급 → member.meta.weekly_recos 누적(문자발송 X).
// 홈페이지(전화/뒷4자리)에서 조회. 자동 스케줄은 운영 환경의 예약 함수(pg_cron/Edge)가 본 로직을 호출.

/** 발급 대상(무료회원) 수 + 최근 발급 회차 요약 — RecommendPage 발급 카드용. */
export function useWeeklyFreeRecoStatus() {
  return useQuery({
    queryKey: ['weekly-free-reco-status'],
    queryFn: async (): Promise<{ freeCount: number; lastRound: number | null; lastIssuedAt: string | null }> => {
      if (dataSource === 'supabase') return supa.fetchWeeklyFreeRecoStatus()
      const members = readDb().members.filter((m) => m.grade === 'free')
      let lastRound: number | null = null
      let lastIssuedAt: string | null = null
      for (const m of members) {
        const recos = Array.isArray(m.meta?.weekly_recos) ? (m.meta!.weekly_recos as WeeklyRecoIssue[]) : []
        const top = recos[0]
        if (top && (lastIssuedAt === null || top.issued_at > lastIssuedAt)) {
          lastIssuedAt = top.issued_at
          lastRound = top.round_no
        }
      }
      return { freeCount: members.length, lastRound, lastIssuedAt }
    },
  })
}

export interface WeeklyIssueResult {
  issued: number // 신규 발급된 회원 수
  skipped: number // 이미 이번 회차 발급된 회원 수
  round_no: number
}

/**
 * 무료회원 주간 발급 실행(수동 트리거 = 운영 스케줄러와 동일 로직). 멱등:
 * 회원이 이미 대상 회차를 받았으면 건너뛴다. 문자 발송은 하지 않는다(요구사항).
 */
export function useIssueWeeklyFreeReco() {
  const user = useCurrentUser()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<WeeklyIssueResult> => {
      if (dataSource === 'supabase') return supa.issueWeeklyFreeReco(user?.id ?? null)
      const cur = readDb()
      const cfg = cur.site_settings.weekly_free_reco ?? WEEKLY_FREE_RECO_DEFAULT
      const setCount = Math.max(1, cfg.set_count || WEEKLY_FREE_RECO_DEFAULT.set_count)
      const rounds = cur.lotto_rounds
      const exclude = resolveExcludeForGrade(cur.site_settings, 'free')
      const targetRound = rounds.reduce((mx, r) => Math.max(mx, r.round_no), 0) + 1
      let issued = 0
      let skipped = 0
      const ts = nowIso()
      mutateDb((db) => {
        for (const m of db.members) {
          if (m.grade !== 'free') continue
          const recos = Array.isArray(m.meta?.weekly_recos) ? (m.meta!.weekly_recos as WeeklyRecoIssue[]) : []
          if (recos[0]?.round_no === targetRound) {
            skipped++
            continue
          }
          // 회원별 발송갯수 override(현장 피드백). 미설정 시 전역 set_count.
          const mCount = typeof m.meta?.weekly_reco_count === 'number' && m.meta.weekly_reco_count > 0
            ? (m.meta.weekly_reco_count as number)
            : setCount
          const res = generateRecommendation(rounds, exclude, {
            mode: 20,
            setCount: mCount,
            seed: memberSeed(m.id, targetRound),
          })
          const issue: WeeklyRecoIssue = { round_no: targetRound, issued_at: ts, sets: res.sets }
          m.meta = { ...m.meta, weekly_recos: [issue, ...recos].slice(0, WEEKLY_RECO_KEEP) }
          issued++
        }
        db.logs.push({
          id: genId('log'),
          kind: 'admin',
          actor: user?.id ?? null,
          action: 'reco.weekly_issue',
          target_type: 'member',
          target_id: null,
          meta: { count: issued, skipped, round_no: targetRound, set_count: setCount, channel: 'weekly_free' },
          created_at: ts,
        })
      })
      return { issued, skipped, round_no: targetRound }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: memberKeys.all })
      qc.invalidateQueries({ queryKey: ['weekly-free-reco-status'] })
    },
  })
}
