// 로또기록 모듈 데이터 훅 (CLAUDE §1·§8, BUILD_PROMPTS Phase 6 — 스샷 있음, 원본 구조 재현).
// 회차/베팅은 전역 데이터(역할 스코프 없음). '당첨 확정'은 회차 베팅의 등수/당첨금을 산정하고
// 1~3등 당첨자의 win_history 를 갱신(§8 당첨자 세그먼트) → lotto/bets/members 쿼리 무효화.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Bet, LogEntry, LottoRound } from '@/types/db'
import { genId, mutateDb, nowIso, readDb } from '@/lib/db/store'
import { useCurrentUser } from '@/lib/auth'
import { betKeys, lottoKeys, memberKeys } from '@/lib/queryKeys'
import { gradeRank, lottoSum, oddEven, prizeForRank } from '@/lib/lotto'

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
    queryFn: (): RoundRow[] => {
      const db = readDb()
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
