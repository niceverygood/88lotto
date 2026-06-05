// 로또기록 모듈 — supabase 쓰기 경로 (M7). dataSource==='supabase' 일 때 api.ts 의 뮤테이션이 호출.
// mock 의 mutateDb 부수효과(§8)를 미러링한다:
//   당첨 확정 → 회차 베팅 등수/당첨금 (재)산정 + 1~3등 회원 win_history 갱신 + confirmed_at + 로그
//   회차 등록 → 중복 검사 후 미확정 회차 추가 + 로그
// 회차/베팅은 전역 데이터(RLS 스코프 없음). 읽기(useRounds)는 fetchTables 스냅샷으로 재사용.
// TODO(live-verify): 회차 베팅 채점은 행 단위 update — 대량 회차는 RPC(set-based)로 이관 권장.
import type { Bet, LottoRound } from '@/types/db'
import { nowIso } from '@/lib/db/store'
import { insertLog, sb } from '@/lib/db/remote'
import { gradeRank, lottoSum, oddEven, prizeForRank } from '@/lib/lotto'
import type { RegisterResult, RegisterRoundInput } from './api'

/** 당첨 확정: 회차 베팅 등수/당첨금 (재)산정 + 1~3등 회원 win_history 갱신. 멱등. */
export async function confirmRound(roundNo: number, actor: string | null): Promise<void> {
  const { data: rData, error: re } = await sb()
    .from('lotto_rounds')
    .select('*')
    .eq('round_no', roundNo)
    .maybeSingle()
  if (re) throw re
  const round = rData as LottoRound | null
  if (!round) return

  const { data: bData, error: be } = await sb().from('bets').select('*').eq('round_no', roundNo)
  if (be) throw be
  const bets = (bData ?? []) as Bet[]

  let winners = 0
  let prizeSum = 0
  for (const bet of bets) {
    const rank = gradeRank(bet.numbers, round.numbers, round.bonus)
    const prize = prizeForRank(round, rank)
    const { error } = await sb().from('bets').update({ rank, prize }).eq('id', bet.id)
    if (error) throw error
    if (rank != null) {
      winners += 1
      prizeSum += prize ?? 0
    }
    if (rank != null && rank <= 3 && bet.member_ref) {
      const { error: me } = await sb()
        .from('members')
        .update({ win_history: `${roundNo}회 ${rank}등` })
        .eq('id', bet.member_ref)
      if (me) throw me
    }
  }

  const { error: ue } = await sb()
    .from('lotto_rounds')
    .update({ confirmed_at: nowIso() })
    .eq('round_no', roundNo)
  if (ue) throw ue
  await insertLog({
    kind: 'admin',
    actor,
    action: 'lotto.confirm',
    target_type: 'lotto_round',
    target_id: String(roundNo),
    meta: { winners, prizeSum },
  })
}

/** 회차 등록(당첨번호 입력). 중복 회차는 거부. 미확정 상태로 추가. */
export async function registerRound(
  v: RegisterRoundInput,
  actor: string | null,
): Promise<RegisterResult> {
  const { data: existing, error: ce } = await sb()
    .from('lotto_rounds')
    .select('round_no')
    .eq('round_no', v.round_no)
    .maybeSingle()
  if (ce) throw ce
  if (existing) return { ok: false, error: '이미 존재하는 회차입니다.' }

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
  const { error } = await sb().from('lotto_rounds').insert(round)
  if (error) throw error
  await insertLog({
    kind: 'admin',
    actor,
    action: 'lotto.register',
    target_type: 'lotto_round',
    target_id: String(v.round_no),
    meta: { numbers: round.numbers, bonus: round.bonus },
  })
  return { ok: true }
}
