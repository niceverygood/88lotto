// 로또(6/45) 순수 도메인 로직 — React/UI 비의존. seed(lib) 와 features/lotto 가 함께 import 해
// '시드 생성'과 '당첨 확정'이 동일한 규칙으로 등수/당첨금을 산정하도록 단일 출처로 둔다.
import type { LottoRound } from '@/types/db'

export const LOTTO_MIN = 1
export const LOTTO_MAX = 45
export const LOTTO_PICK = 6

/** 6개 번호 합. */
export function lottoSum(numbers: readonly number[]): number {
  return numbers.reduce((a, n) => a + n, 0)
}

/** "홀:짝" 문자열 (예: "3:3"). */
export function oddEven(numbers: readonly number[]): string {
  const odd = numbers.filter((n) => n % 2 === 1).length
  return `${odd}:${numbers.length - odd}`
}

/** 당첨번호와 일치하는 개수. */
export function matchCount(bet: readonly number[], win: readonly number[]): number {
  const set = new Set(win)
  return bet.reduce((c, n) => (set.has(n) ? c + 1 : c), 0)
}

/**
 * 베팅 등수 판정 (6/45 표준 규칙).
 * 1등 6 / 2등 5+보너스 / 3등 5 / 4등 4 / 5등 3 / 그외 null(미당첨).
 */
export function gradeRank(
  bet: readonly number[],
  win: readonly number[],
  bonus: number,
): number | null {
  const m = matchCount(bet, win)
  if (m === 6) return 1
  if (m === 5) return bet.includes(bonus) ? 2 : 3
  if (m === 4) return 4
  if (m === 3) return 5
  return null
}

// TODO(live-verify): prize_1/2/3 을 '1인당 당첨금'으로 간주. 4·5등은 고정금으로 가정(원본 규칙 확인 필요).
const FIXED_PRIZE: Record<number, number> = { 4: 50000, 5: 5000 }

/** 등수 → 당첨금. 미당첨(null)은 null. */
export function prizeForRank(
  round: Pick<LottoRound, 'prize_1' | 'prize_2' | 'prize_3'>,
  rank: number | null,
): number | null {
  if (rank == null) return null
  if (rank === 1) return round.prize_1 ?? 0
  if (rank === 2) return round.prize_2 ?? 0
  if (rank === 3) return round.prize_3 ?? 0
  return FIXED_PRIZE[rank] ?? 0
}

export const RANK_LABEL: Record<number, string> = {
  1: '1등',
  2: '2등',
  3: '3등',
  4: '4등',
  5: '5등',
}

/** 당첨번호 표시용 등수 라벨(미당첨 포함). */
export function rankLabel(rank: number | null): string {
  return rank == null ? '미당첨' : RANK_LABEL[rank]
}
