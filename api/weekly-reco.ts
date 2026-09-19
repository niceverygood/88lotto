// Vercel 크론 함수 — 회원 추천조합 자동발급(현장 피드백, 문자발송 X).
// vercel.json crons 가 매일 00:00 UTC(=09:00 KST) 호출.
// 대상(현장 피드백 6/11 <추천번호> 7): ① 무료회원 = 기본 금요일(회원별 weekly_reco_day 우선)
// ② 유료 등 그 외 등급 = 회원정보창에 발송요일이 '설정된' 회원만, 그 요일에 발급.
// 세트수 = 회원별 weekly_reco_count(없으면 전역), 등급별 고정/제외 규칙 적용. 멱등(동일 회차 skip).
//
// ⚠️ 완전 자급자족 단일 파일: Vercel 함수 런타임(ESM)이 api/ 상대 import 를 해석하지 못해
// src/lib/lottoGenerator.ts 의 생성 로직 사본 + 최소 타입을 인라인한다(원본 수정 시 동기화).
//
// Vercel 환경변수: SUPABASE_URL(또는 VITE_SUPABASE_URL) / SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET
// 수동 테스트: GET /api/weekly-reco?force=1 (Authorization: Bearer $CRON_SECRET)
import { createClient } from '@supabase/supabase-js'

// ── 최소 타입(소스: src/types/db.ts) ─────────────────────────────────────────
interface LottoRound {
  round_no: number
  draw_date: string
  numbers: number[]
  bonus: number
}
interface LottoExcludeSettings {
  fixed: number[]
  excluded: number[]
}
interface LottoExcludeRule {
  round_no: number
  grade: string | null
  fixed: number[]
  excluded: number[]
  effective_from: string
}
interface WeeklyRecoIssue {
  round_no: number
  issued_at: string
  sets: number[][]
}
interface SiteSettingsLite {
  lotto_exclude: LottoExcludeSettings
  lotto_exclude_history?: LottoExcludeRule[]
  weekly_free_reco?: { enabled: boolean; set_count: number; logic_ratio?: number; paid_sms?: boolean }
  sms?: { oneshot_enabled?: boolean; sender_no?: string }
}

const LOTTO_MIN = 1
const LOTTO_MAX = 45
const LOTTO_PICK = 6

// 등급별 활성 고정/제외 규칙(소스: src/lib/lotto.ts resolveExcludeForGrade)
function resolveExcludeForGrade(settings: SiteSettingsLite, grade: string | null): LottoExcludeSettings {
  const d = new Date(Date.now() + 9 * 3600_000) // KST
  const today = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  const effective = (settings.lotto_exclude_history ?? [])
    .filter((r) => r.effective_from <= today)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from) || b.round_no - a.round_no)
  const pick = (g: string | null): LottoExcludeRule | undefined =>
    effective.find((r) => (r.grade ?? null) === g)
  const rule = (grade != null ? pick(grade) : undefined) ?? pick(null)
  return rule ? { fixed: rule.fixed, excluded: rule.excluded } : settings.lotto_exclude
}

// ── 이하 생성 로직: src/lib/lottoGenerator.ts 사본(임포트 제거) ─────────────────
// 로또(6/45) 추천 번호 생성기 — 순수 도메인 로직(React/UI 비의존).
//
// 운영사 「88로또 제외수 프로그램」의 문서화된 방식(프로그램_로직_제외수)을 그대로 구현한다.
// 핵심은 '제외수(excluded numbers)' 산정이다 — 과거 회차 데이터에서 5개 규칙으로 제외 후보를
// 뽑아 10·15·20개로 압축하고, 남은 풀(45 − 제외수)에서 패턴 품질 필터를 통과하는 6개 조합을 만든다.
//
// 5개 제외 규칙(문서 '88로또 프로그램 실제 적용 방식'):
//   ① 직전회차 — 직전 당첨 6개 중 최상위 2 + 최하위 1 = 3개
//   ② 직전회차 보너스 — 보너스 1개
//   ③ 월별 저출현 — 대상 추첨월에 역대 출현이 가장 적은 번호 (포아송·평균회귀 논거)
//   ④ 회차 저빈도 — 전체 저빈도 번호(대상 회차가 10의 배수면 가중)
//   ⑤ 40번대 과출현 — 최근 구간 40~45 중 과출현 2개
//   + 운영자 수동 제외(site_settings.lotto_exclude.excluded)는 항상 적용, 수동 고정수는 항상 포함.
//
// 데이터가 적으면(시드 16회차) 절대 임계치 대신 '순위 기반 압축'으로 동작한다 — 문서의 "압축 필터"와 동일.
//
// ⚠️ 확률 정직성: 6/45 모든 6개 조합의 1등 확률은 1/8,145,060 로 동일하다. 본 생성기는 제외수 기준에
// 따라 '제시할 조합을 선별'할 뿐 당첨 확률을 높이지 않는다. 어떤 함수/주석/반환값도 확률 향상을
// 단언하지 않는다(문서의 '확률이 N배 증가' 주장은 전제가 보장되지 않아 사실로 취급하지 않음).

// 제외수 개수 — 10/15/20 프리셋 외에 임의 개수 입력 가능(현장 피드백).
// 6개 조합이 남아야 하므로 1..(45-6)=39 로 클램프한다.
export type ExclusionMode = number

export const EXCLUSION_MODE_MIN = 1
export const EXCLUSION_MODE_MAX = LOTTO_MAX - LOTTO_PICK // 39

export function clampExclusionMode(n: number): number {
  if (!Number.isFinite(n)) return 20
  return Math.min(EXCLUSION_MODE_MAX, Math.max(EXCLUSION_MODE_MIN, Math.round(n)))
}

export interface GenerateOptions {
  mode: ExclusionMode
  /** 생성할 추천 조합 수. */
  setCount: number
  /** 재현 가능한 결과용 시드(미지정 시 무작위). */
  seed?: number
}

export interface ExclusionReason {
  number: number
  /** 규칙 키 — UI 라벨 매핑에 사용. */
  rule: ExclusionRuleKey
}

export type ExclusionRuleKey = 'prev' | 'bonus' | 'month' | 'freq' | 'forties' | 'manual'

export interface GenerateResult {
  targetRound: number
  drawMonth: number // 1..12
  mode: ExclusionMode
  excluded: number[] // 최종 제외수(오름차순)
  reasons: ExclusionReason[] // 번호별 제외 사유(중복 번호는 최상위 규칙 1개)
  fixed: number[] // 적용된 수동 고정수
  pool: number[] // 남은 풀(오름차순)
  sets: number[][] // 추천 조합(각 6개 오름차순)
  basis: GenerateBasis
}

export interface GenerateBasis {
  roundsUsed: number
  prevRound: number | null
  prevNumbers: number[] | null
  prevBonus: number | null
  sumBand: [number, number] // 조합 합 권장 밴드
  relaxed: boolean // 풀이 좁아 품질 필터를 완화했는지
}

const ALL_NUMBERS: readonly number[] = Array.from(
  { length: LOTTO_MAX - LOTTO_MIN + 1 },
  (_, i) => i + LOTTO_MIN,
)

// 규칙 배분(문서 '결과값' 20개 기준: 3+1+7+7+2=20). 10·15·20은 원본 표 그대로,
// 그 외 임의 개수는 같은 비율(직전3+보너스1 제외분을 월별·빈도에 균분)로 산정한다.
const RULE_QUOTA_PRESET: Record<number, { month: number; freq: number }> = {
  10: { month: 4, freq: 4 }, // 직전3·보너스1 + 월별4·빈도4 − 압축 = 상위 10
  15: { month: 5, freq: 6 },
  20: { month: 7, freq: 7 },
}

function ruleQuota(mode: number): { month: number; freq: number } {
  const preset = RULE_QUOTA_PRESET[mode]
  if (preset) return preset
  // 직전회차(3)+보너스(1) 후보를 제외한 나머지를 월별/빈도에 반씩 배분.
  const rest = Math.max(2, mode - 4)
  const month = Math.max(1, Math.floor(rest / 2))
  const freq = Math.max(1, rest - month)
  return { month, freq }
}

// ── PRNG (mulberry32) — 시드 가능한 결정적 난수 ─────────────────────────
function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── 통계 헬퍼 ───────────────────────────────────────────────────────────
function sortedRoundsDesc(rounds: readonly LottoRound[]): LottoRound[] {
  return [...rounds].sort((a, b) => b.round_no - a.round_no)
}

/** 번호별 출현 횟수(최근 window 회차, 미지정 시 전체). */
export function numberFrequencies(
  rounds: readonly LottoRound[],
  window?: number,
): Map<number, number> {
  const desc = sortedRoundsDesc(rounds)
  const scope = window != null ? desc.slice(0, window) : desc
  const freq = new Map<number, number>()
  for (const n of ALL_NUMBERS) freq.set(n, 0)
  for (const r of scope) for (const n of r.numbers) freq.set(n, (freq.get(n) ?? 0) + 1)
  return freq
}

/** 대상 추첨월(1..12)에 한정한 번호별 출현 횟수. */
export function monthlyFrequencies(
  rounds: readonly LottoRound[],
  month: number,
): Map<number, number> {
  const freq = new Map<number, number>()
  for (const n of ALL_NUMBERS) freq.set(n, 0)
  for (const r of rounds) {
    if (new Date(r.draw_date).getMonth() + 1 !== month) continue
    for (const n of r.numbers) freq.set(n, (freq.get(n) ?? 0) + 1)
  }
  return freq
}

/** 조합 합의 권장 밴드 [lo, hi] — 역대 합 분포의 ~10~90 분위. 데이터 부족 시 표준 밴드. */
export function sumBand(rounds: readonly LottoRound[]): [number, number] {
  const sums = rounds.map((r) => r.numbers.reduce((a, n) => a + n, 0)).sort((a, b) => a - b)
  if (sums.length < 8) return [100, 175]
  const at = (q: number) => sums[Math.min(sums.length - 1, Math.floor(q * sums.length))]
  return [at(0.1), at(0.9)]
}

// 번호 → 구간 버킷(0:1-9, 1:10-19, 2:20-29, 3:30-39, 4:40-45).
function decadeBucket(n: number): number {
  return Math.min(4, Math.floor(n / 10))
}

function maxConsecutiveRun(sortedAsc: readonly number[]): number {
  let best = 1
  let cur = 1
  for (let i = 1; i < sortedAsc.length; i++) {
    cur = sortedAsc[i] === sortedAsc[i - 1] + 1 ? cur + 1 : 1
    if (cur > best) best = cur
  }
  return best
}

function consecutivePairCount(sortedAsc: readonly number[]): number {
  let c = 0
  for (let i = 1; i < sortedAsc.length; i++) if (sortedAsc[i] === sortedAsc[i - 1] + 1) c++
  return c
}

function oddCount(nums: readonly number[]): number {
  return nums.filter((n) => n % 2 === 1).length
}

// ── 제외수 산정 ─────────────────────────────────────────────────────────
interface Candidate {
  number: number
  rule: ExclusionRuleKey
  priority: number // 클수록 우선 제외
  score: number // 동순위 내 정렬(클수록 우선)
}

/**
 * 5개 규칙으로 제외 후보를 모아 mode(10/15/20)개로 압축한다.
 * 수동 제외는 항상 포함(압축 한도 무관), 수동 고정수는 후보에서 제거.
 */
export function computeExclusions(
  rounds: readonly LottoRound[],
  month: number,
  targetRound: number,
  mode: ExclusionMode,
  manual: LottoExcludeSettings,
): { excluded: number[]; reasons: ExclusionReason[] } {
  const desc = sortedRoundsDesc(rounds)
  const prev = desc[0] ?? null
  const fixedSet = new Set(manual.fixed)
  const quota = ruleQuota(mode)
  const cands: Candidate[] = []

  // ① 직전회차 상위2·하위1
  if (prev) {
    const asc = [...prev.numbers].sort((a, b) => a - b)
    const picks = [asc[0], asc[asc.length - 1], asc[asc.length - 2]]
    for (const n of picks) cands.push({ number: n, rule: 'prev', priority: 100, score: 0 })
  }
  // ② 직전회차 보너스
  if (prev) cands.push({ number: prev.bonus, rule: 'bonus', priority: 95, score: 0 })

  // ③ 월별 저출현 — 해당 월 출현이 적은 번호 우선(동률은 전체 저빈도)
  {
    const mFreq = monthlyFrequencies(rounds, month)
    const allFreq = numberFrequencies(rounds)
    const ranked = [...ALL_NUMBERS].sort(
      (a, b) => (mFreq.get(a)! - mFreq.get(b)!) || (allFreq.get(a)! - allFreq.get(b)!),
    )
    for (const n of ranked.slice(0, quota.month)) {
      cands.push({ number: n, rule: 'month', priority: 80, score: 45 - (mFreq.get(n) ?? 0) })
    }
  }

  // ④ 회차 저빈도 — 전체 저빈도 번호. 대상 회차가 10의 배수면 우선순위 가중(문서 '10배수 회차').
  {
    const allFreq = numberFrequencies(rounds)
    const ranked = [...ALL_NUMBERS].sort((a, b) => allFreq.get(a)! - allFreq.get(b)!)
    const boost = targetRound % 10 === 0 ? 5 : 0
    for (const n of ranked.slice(0, quota.freq)) {
      cands.push({ number: n, rule: 'freq', priority: 70 + boost, score: 45 - (allFreq.get(n) ?? 0) })
    }
  }

  // ⑤ 40번대 과출현 2개 — 최근 20회차 기준 40~45 중 많이 나온 번호(과대 편입 회피)
  {
    const recent = numberFrequencies(rounds, 20)
    const forties = ALL_NUMBERS.filter((n) => n >= 40).sort(
      (a, b) => recent.get(b)! - recent.get(a)!,
    )
    for (const n of forties.slice(0, 2)) {
      cands.push({ number: n, rule: 'forties', priority: 60, score: recent.get(n) ?? 0 })
    }
  }

  // 고정수는 어떤 규칙으로도 제외하지 않는다.
  const statCands = cands.filter((c) => !fixedSet.has(c.number))

  // 번호별 최상위(priority,score) 후보만 남겨 압축 정렬 → 상위 mode개.
  const best = new Map<number, Candidate>()
  for (const c of statCands) {
    const cur = best.get(c.number)
    if (!cur || c.priority > cur.priority || (c.priority === cur.priority && c.score > cur.score)) {
      best.set(c.number, c)
    }
  }
  const compressed = [...best.values()]
    .sort((a, b) => b.priority - a.priority || b.score - a.score)
    .slice(0, clampExclusionMode(mode))

  // 수동 제외(고정수와 겹치면 고정수 우선) 병합.
  const reasons: ExclusionReason[] = []
  const seen = new Set<number>()
  for (const c of compressed) {
    reasons.push({ number: c.number, rule: c.rule })
    seen.add(c.number)
  }
  for (const n of manual.excluded) {
    if (fixedSet.has(n) || seen.has(n)) continue
    reasons.push({ number: n, rule: 'manual' })
    seen.add(n)
  }
  const excluded = [...seen].sort((a, b) => a - b)
  return { excluded, reasons }
}

// ── 조합 품질 필터 ──────────────────────────────────────────────────────
interface QualityOpts {
  sumBand: [number, number]
  pastSets: Set<string>
  relaxed: boolean
}

function key(nums: readonly number[]): string {
  return [...nums].sort((a, b) => a - b).join('-')
}

/** 패턴 품질 판정(문서 '극단 조합 회피' + 특허 제2기준: 구간분포·홀짝·연번·합). */
function passesQuality(combo: readonly number[], opts: QualityOpts): boolean {
  const asc = [...combo].sort((a, b) => a - b)
  // 역대 동일 조합 회피
  if (opts.pastSets.has(asc.join('-'))) return false

  const buckets = new Set(asc.map(decadeBucket))
  const bucketCounts = new Map<number, number>()
  for (const n of asc) bucketCounts.set(decadeBucket(n), (bucketCounts.get(decadeBucket(n)) ?? 0) + 1)
  const maxBucket = Math.max(...bucketCounts.values())
  const odd = oddCount(asc)
  const total = asc.reduce((a, n) => a + n, 0)

  // 완화 모드(풀이 좁을 때): 한 구간 몰림과 연속 6연번만 막는다.
  if (opts.relaxed) {
    return maxBucket <= 5 && maxConsecutiveRun(asc) < LOTTO_PICK
  }

  if (buckets.size < 3) return false // 최소 3개 구간 분산
  if (maxBucket >= 4) return false // 한 구간 4개 이상 몰림 회피(예: 40번대만)
  if (odd === 0 || odd === LOTTO_PICK) return false // 전홀/전짝 회피
  if (maxConsecutiveRun(asc) >= 3) return false // 3연번 이상 회피
  if (consecutivePairCount(asc) > 1) return false // 연속쌍 최대 1
  if (total < opts.sumBand[0] || total > opts.sumBand[1]) return false // 합 밴드
  return true
}

// ── 조합 생성 ───────────────────────────────────────────────────────────
function drawCombo(pool: readonly number[], fixed: readonly number[], rng: () => number): number[] {
  const need = LOTTO_PICK - fixed.length
  const bag = pool.filter((n) => !fixed.includes(n))
  // Fisher–Yates 부분 셔플
  const arr = [...bag]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return [...fixed, ...arr.slice(0, need)].sort((a, b) => a - b)
}

function generateSets(
  pool: readonly number[],
  fixed: readonly number[],
  count: number,
  rng: () => number,
  band: [number, number],
  pastSets: Set<string>,
): { sets: number[][]; relaxed: boolean } {
  const out: number[][] = []
  const used = new Set<string>()
  let relaxed = false
  const TRY_PER_SET = 400

  while (out.length < count) {
    let placed = false
    for (let attempt = 0; attempt < TRY_PER_SET; attempt++) {
      const combo = drawCombo(pool, fixed, rng)
      const k = key(combo)
      if (used.has(k)) continue
      if (passesQuality(combo, { sumBand: band, pastSets, relaxed })) {
        out.push(combo)
        used.add(k)
        placed = true
        break
      }
    }
    if (!placed) {
      if (!relaxed) {
        relaxed = true // 1차 실패 → 필터 완화 후 재시도
        continue
      }
      // 완화로도 새 조합을 못 뽑으면(풀 고갈) 종료.
      break
    }
  }
  return { sets: out, relaxed }
}

// ── 오케스트레이션 ──────────────────────────────────────────────────────
/**
 * 추천 결과 생성. rounds 가 비면 빈 결과(sets=[]) 를 돌려준다(페이지가 안내).
 * targetRound = 최신 회차 + 1, drawMonth 는 직전 추첨월 기준(없으면 현재월).
 */
export function generateRecommendation(
  rounds: readonly LottoRound[],
  manual: LottoExcludeSettings,
  opts: GenerateOptions,
): GenerateResult {
  const desc = sortedRoundsDesc(rounds)
  const prev = desc[0] ?? null
  const targetRound = prev ? prev.round_no + 1 : 1
  const drawMonth = prev ? new Date(prev.draw_date).getMonth() + 1 : new Date().getMonth() + 1
  const band = sumBand(rounds)
  const rng = makeRng(opts.seed ?? (Date.now() & 0xffffffff))

  const { excluded, reasons } = computeExclusions(rounds, drawMonth, targetRound, opts.mode, manual)

  // 고정수는 항상 포함(제외수와 상호배타 — 설정 UI 보장, 여기서도 방어).
  const fixed = manual.fixed.filter((n) => n >= LOTTO_MIN && n <= LOTTO_MAX).slice(0, LOTTO_PICK)
  const excludedSet = new Set(excluded)
  for (const f of fixed) excludedSet.delete(f)

  let pool = ALL_NUMBERS.filter((n) => !excludedSet.has(n))
  // 풀 하한 방어: 통계 제외가 과해 6개 미만이면 우선순위 낮은 제외부터 되돌린다(수동 제외는 유지).
  if (pool.length < LOTTO_PICK) {
    const manualSet = new Set(manual.excluded)
    const droppable = [...excludedSet].filter((n) => !manualSet.has(n))
    while (pool.length < LOTTO_PICK && droppable.length) {
      const back = droppable.pop()!
      excludedSet.delete(back)
      pool = ALL_NUMBERS.filter((n) => !excludedSet.has(n))
    }
  }

  const pastSets = new Set(rounds.map((r) => key(r.numbers)))
  const { sets, relaxed } =
    pool.length >= LOTTO_PICK
      ? generateSets(pool, fixed, Math.max(1, opts.setCount), rng, band, pastSets)
      : { sets: [], relaxed: false }

  const finalExcluded = ALL_NUMBERS.filter((n) => !pool.includes(n))
  return {
    targetRound,
    drawMonth,
    mode: opts.mode,
    excluded: finalExcluded,
    reasons: reasons.filter((r) => finalExcluded.includes(r.number)),
    fixed,
    pool,
    sets,
    basis: {
      roundsUsed: rounds.length,
      prevRound: prev?.round_no ?? null,
      prevNumbers: prev ? [...prev.numbers].sort((a, b) => a - b) : null,
      prevBonus: prev?.bonus ?? null,
      sumBand: band,
      relaxed,
    },
  }
}

export const EXCLUSION_RULE_LABEL: Record<ExclusionRuleKey, string> = {
  prev: '직전회차 상·하위',
  bonus: '직전 보너스',
  month: '월별 저출현',
  freq: '저빈도',
  forties: '40번대 과출현',
  manual: '수동 제외',
}

export const MODE_OPTIONS: ExclusionMode[] = [10, 15, 20]

// ── 유료회원 지정요일 조합 SMS 자동발송(현장 피드백 6/18) ────────────────────────
// 유료 등급(골드/골드+/VIP/로얄)만 대상. 무료는 발급만(문자 X).
const PAID_GRADES = new Set(['gold', 'goldp', 'vip', 'royal'])

// 멀티테넌트 브랜드(배포별 VITE_BRAND). 서버함수라 process.env 사용(클라 lib/brand 와 동일 값).
const BRAND_NAME = process.env.VITE_BRAND || '88로또'

/** 조합 목록 → SMS 본문(LMS). 하단 "홈페이지에서도 확인 가능합니다" 문구는 현장 피드백(7/24)으로 삭제. */
/**
 * 조합 목록 → SMS 본문. src/lib/sms.ts recoSmsBody 와 동일 규칙(자급자족 중복 — 이 파일은 Vercel
 * 함수 런타임 제약으로 src/ 를 import 하지 못한다. **한쪽을 바꾸면 다른 쪽도 바꿔야 한다.**)
 *
 * 본문은 sms_templates 'recommend' 템플릿에서 온다(현장 8/28, 정의현 차장 — "88로또 조합발송
 * 형식을 플러스로또와 동일하게 바꾸려고 수정을 하는데 반영이 안됩니다"). 이 크론이 템플릿을 읽지
 * 않아서, 설정에서 무엇을 고쳐도 자동발송 문구가 그대로였다. 플러스로또 8/4 변경(D148)의 이식.
 * 변수: $round(회차) · $name(회원명) · $num(조합 리스트).
 */
const RECO_TEMPLATE_FALLBACK = `[${BRAND_NAME}] $round회 추천번호\n$name님\n$num`

function formatComboSms(
  name: string,
  round: number,
  sets: number[][],
  templateBody?: string | null,
): string {
  const lines = sets.map((s, i) => `[${i + 1}] ${s.join(',')}`).join('\n')
  const body = templateBody?.trim() ? templateBody : RECO_TEMPLATE_FALLBACK
  return body
    .replace(/\$round/g, String(Math.max(0, Math.trunc(round))))
    .replace(/\$name/g, name || '회원')
    .replace(/\$num/g, lines)
}

/** 한국 문자 바이트 길이(비ASCII=2byte). SMS=90byte 기준. (src/lib/oneshot.ts koByteLength 동기화) */
function koByteLength(s: string): number {
  let n = 0
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) > 0x7f ? 2 : 1
  return n
}

/** 검증된 발송 함수(/api/send-sms, Fixie 프록시 경유)를 재사용해 1건 발송. */
async function sendComboSms(
  base: string,
  dest: string,
  body: string,
  sender: string,
): Promise<{ ok: boolean; code?: string }> {
  try {
    const r = await fetch(`${base}/api/send-sms`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // 서버-서버 인증(보안 D68) — send-sms 가 내부 호출을 식별.
        ...(process.env.CRON_SECRET ? { 'x-internal-secret': process.env.CRON_SECRET } : {}),
      },
      // msgType 명시(D68): 조합 본문은 90byte 초과라 LMS — 미지정 시 SMS 로 처리돼 402 길이초과 전건 실패.
      body: JSON.stringify({
        dest_phone: dest,
        msg_body: body,
        send_phone: sender,
        msgType: koByteLength(body) <= 90 ? 'SMS' : 'LMS',
      }),
    })
    const d = (await r.json()) as { ok?: boolean; code?: string }
    return { ok: !!d.ok, code: d.code }
  } catch {
    return { ok: false, code: 'NET' }
  }
}

// ── 크론 핸들러 ───────────────────────────────────────────────────────────────
const DEFAULT_DAY = 5 // 금요일(0=일..6=토)
const DEFAULT_COUNT = 30
const KEEP = 8

/** Date.now() 계열 값을 한국 영업일(YYYY-MM-DD)로 고정한다. */
export function kstDay(nowMs: number): string {
  const d = new Date(nowMs + 9 * 3600_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/**
 * 자동발급 대상 판정(순수 함수).
 *
 * 발송 루프와 발송 후 누락 대조(recoAuditMisses)가 **같은 함수**를 쓴다. 판정 규칙이 두 곳에
 * 따로 적혀 있으면 한쪽만 고쳐질 때 "정상 제외"가 누락으로 잡혀 허위 목록이 나간다. 허위가 섞인
 * 누락 목록은 현장이 목록 자체를 무시하게 만들어 진짜 누락을 놓치게 한다.
 *
 * 규칙은 **이 전산의 실제 발송 규칙 그대로**다. 형제 프로젝트(PlusLotto)에는 여기 없는
 * 종료일(end_date) 게이트가 있으나, 그 규칙을 여기로 가져오면 실제로는 발송된 회원이 대조에서
 * 제외돼 진짜 누락이 가려진다. 발송 규칙이 다르면 대조 규칙도 달라야 한다.
 *
 * 반환값이 null 이면 이번 회차 발급 대상이다.
 */
export type RecoSkipReason = 'day' | 'paused' | 'count-zero' | 'already' | null

export interface RecoGateCtx {
  /** KST 요일(0=일). */
  today: number
  force: boolean
  /** 무료 자동발급 토글(site_settings.weekly_free_reco.enabled). */
  autoEnabled: boolean
  /** 유료 지정요일 조합 SMS 가동 여부. */
  paidSmsOn: boolean
  targetRound: number
}

export function recoSkipReason(
  row: { grade: string; meta: Record<string, unknown> | null | undefined },
  ctx: RecoGateCtx,
): RecoSkipReason {
  const meta = row.meta ?? {}
  const day =
    typeof meta.weekly_reco_day === 'number'
      ? (meta.weekly_reco_day as number)
      : row.grade === 'free'
        ? DEFAULT_DAY
        : null // 유료 등 — 발송요일 미설정이면 자동발급 대상 아님
  if (day === null || (!ctx.force && day !== ctx.today)) return 'day'
  // 무료 자동발급 OFF 시: 유료 지정요일 SMS 대상만 계속, 그 외는 발급 안 함(D68 #12).
  if (!ctx.autoEnabled && !ctx.force && !(ctx.paidSmsOn && PAID_GRADES.has(row.grade))) return 'day'
  // 일시정지(조합발송 중단) — force=1 도 우회하지 않는다.
  if (meta.reco_paused === true) return 'paused'
  // 발송갯수 명시적 0 → 발급·문자 제외(현장 6/26).
  if (meta.weekly_reco_count === 0) return 'count-zero'
  const recos = Array.isArray(meta.weekly_recos) ? (meta.weekly_recos as WeeklyRecoIssue[]) : []
  if (recos[0]?.round_no === ctx.targetRound) return 'already'
  return null
}

/** 조합 SMS 가 나가야 하는 회원인지 — 유료 SMS 가동 + 유료등급 + 번호 보유. */
export function expectsComboSms(
  row: { grade: string; phone: string | null },
  ctx: { paidSmsOn: boolean },
): boolean {
  return ctx.paidSmsOn && PAID_GRADES.has(row.grade) && !!row.phone
}

/**
 * 발송 후 누락 대조(순수 함수).
 *
 * 2026-09-16 이 전산에서 유료회원 1,986명 중 1,035명만 발송되고 **951명이 조용히 누락**됐다.
 * 문자업체 쪽 숫자를 현장이 대조해서야 알았다 — 전산은 아무것도 알려주지 않았다.
 * 이 함수는 발송이 끝난 뒤 "받아야 했는데 못 받은 회원"만 추려낸다.
 *
 * 아래는 **정상적인 제외**이며 누락이 아니다. 빼먹으면 신규 가입자까지 매번 목록에 올라와
 * 현장이 목록을 믿지 않게 된다.
 *   1) 발송 시작 이후 가입(registered_after) 2) 일시정지(paused)
 *   3) 발송갯수 0(count_zero)              4) 그날 지정요일 아님(day)
 * 판정은 발송 루프와 **같은 recoSkipReason** 을 쓰므로 규칙이 갈라질 수 없다.
 */
export type RecoMissReason = 'not_issued' | 'sms_missing' | 'sms_failed'

export interface RecoMiss {
  member_id: string
  name: string | null
  phone: string | null
  grade: string
  reason: RecoMissReason
}

export interface RecoAuditExcluded {
  day: number
  paused: number
  count_zero: number
  registered_after: number
  no_phone: number
}

export interface RecoAuditResult {
  round_no: number
  checked: number
  /** 이번 회차에 발급됐어야 하는 회원 수(정상 제외분 제외). */
  expected: number
  misses: RecoMiss[]
  excluded: RecoAuditExcluded
}

export interface RecoAuditCtx extends RecoGateCtx {
  /** 이번 발송이 시작된 시각(ISO). 이후 가입자는 대상이 아니므로 제외한다. */
  sinceIso: string
  smsOk: Set<string>
  smsFail: Set<string>
}

export function recoAuditMisses(
  rows: {
    id: string
    grade: string
    name: string | null
    phone: string | null
    meta: Record<string, unknown> | null
    registered_at?: string | null
  }[],
  ctx: RecoAuditCtx,
): RecoAuditResult {
  const misses: RecoMiss[] = []
  const excluded: RecoAuditExcluded = {
    day: 0,
    paused: 0,
    count_zero: 0,
    registered_after: 0,
    no_phone: 0,
  }
  let expected = 0

  for (const r of rows) {
    // 발송 시작 이후 가입 — 이번 회차 대상이 아니다. 가장 먼저 걸러야 신규 가입자가
    // 매번 누락으로 올라오는 일이 없다.
    if (typeof r.registered_at === 'string' && r.registered_at > ctx.sinceIso) {
      excluded.registered_after++
      continue
    }
    const skip = recoSkipReason(r, ctx)
    if (skip === 'day') {
      excluded.day++
      continue
    }
    if (skip === 'paused') {
      excluded.paused++
      continue
    }
    if (skip === 'count-zero') {
      excluded.count_zero++
      continue
    }

    expected++
    if (skip === null) {
      // 발급 대상인데 발급 기록이 없다 = 조합 자체가 안 나갔다(951명 사고 유형).
      misses.push({ member_id: r.id, name: r.name, phone: r.phone, grade: r.grade, reason: 'not_issued' })
      continue
    }
    // skip === 'already' — 발급은 됐다. 조합문자 대상이면 문자까지 확인한다.
    if (!expectsComboSms(r, ctx)) {
      // 유료인데 번호가 없으면 문자를 보낼 수 없다 — 누락이 아니라 회원정보 문제로 따로 센다.
      if (ctx.paidSmsOn && PAID_GRADES.has(r.grade) && !r.phone) excluded.no_phone++
      continue
    }
    if (ctx.smsOk.has(r.id)) continue
    misses.push({
      member_id: r.id,
      name: r.name,
      phone: r.phone,
      grade: r.grade,
      reason: ctx.smsFail.has(r.id) ? 'sms_failed' : 'sms_missing',
    })
  }

  return { round_no: ctx.targetRound, checked: rows.length, expected, misses, excluded }
}

export interface MemberScanRow {
  id: string
  grade: string
  name: string | null
  phone: string | null
  meta: Record<string, unknown> | null
  registered_at: string | null
}

/**
 * 발급·대조 대상 회원 전체 스캔.
 *
 * 커서(id 오름차순 + gt) 방식 — offset(.range)은 읽는 도중 행이 끼거나 빠지면 페이지 경계가
 * 밀려 같은 회원을 두 번 읽거나(이중 발송) 건너뛴다(조용한 누락).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanMembers(sb: any, page: number): Promise<MemberScanRow[]> {
  const rows: MemberScanRow[] = []
  let cursor: string | null = null
  for (;;) {
    let q = sb
      .from('members')
      .select('id, grade, name, phone, meta, registered_at')
      .eq('is_deleted', false)
      .eq('is_withdrawn', false)
      .eq('is_suspended', false) // 일시정지(정지) 회원은 자동발급·문자 제외(현장 6/26)
      .order('id')
      .limit(page)
    if (cursor !== null) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw error
    const got = (data ?? []) as MemberScanRow[]
    rows.push(...got)
    if (got.length < page) break
    cursor = got[got.length - 1].id
  }
  return rows
}

/** 이번 회차 조합문자 발송 기록(성공/실패) 회원 id 집합. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scanRecoSms(sb: any, sinceIso: string, page: number): Promise<{ ok: Set<string>; fail: Set<string> }> {
  const ok = new Set<string>()
  const fail = new Set<string>()
  let cursor: string | null = null
  for (;;) {
    let q = sb
      .from('sms_sends')
      .select('id, member_id, status')
      .eq('type', 'recommend')
      .gte('sent_at', sinceIso)
      .order('id')
      .limit(page)
    if (cursor !== null) q = q.gt('id', cursor)
    const { data, error } = await q
    if (error) throw error
    const got = (data ?? []) as { id: string; member_id: string | null; status: string | null }[]
    for (const row of got) {
      if (!row.member_id) continue
      // 같은 회원에 성공·실패가 섞이면(재발송) 성공을 우선한다 — 받은 사람은 누락이 아니다.
      if (row.status === '발송완료') {
        ok.add(row.member_id)
        fail.delete(row.member_id)
      } else if (!ok.has(row.member_id)) {
        fail.add(row.member_id)
      }
    }
    if (got.length < page) break
    cursor = got[got.length - 1].id
  }
  return { ok, fail }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default async function handler(req: any, res: any) {
  // fail-closed(D68): CRON_SECRET 미설정이면 '열림'이 아니라 '차단'. 미설정을 가시화.
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return res.status(500).json({ ok: false, code: 'CONFIG', message: 'CRON_SECRET 미설정' })
  }
  if (req.headers?.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, code: 'AUTH' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return res.status(500).json({ ok: false, code: 'CONFIG', message: 'SUPABASE_URL/SERVICE_ROLE_KEY 미설정' })
  }
  const force = String(req.query?.force ?? '') === '1'
  // 발송은 하지 않고 누락 대조만 수행. 발송 경로와 상호 배타 — 대조 실행이 또 다른 대조를
  // 부르지 않도록 아래 자동 트리거보다 먼저 분기한다.
  const auditOnly = String(req.query?.audit ?? '') === '1'
  // 시간예산으로 한 번에 못 끝낸 잔여분을 이어받는 후속 실행의 깊이(무한 연쇄 방지).
  const chain = Math.max(0, Number(req.query?.chain ?? 0) || 0)
  const sb = createClient(url, key, { auth: { persistSession: false } })

  try {
    const startedAt = Date.now() // 시간예산 가드 기준(아래 BUDGET_MS)
    const kst = new Date(Date.now() + 9 * 3600_000)
    const today = kst.getUTCDay() // KST 보정 후 UTC 요일 = KST 요일
    const ts = new Date().toISOString()

    const { data: sData, error: se } = await sb.from('site_settings').select('*').eq('id', 1).maybeSingle()
    if (se) throw se
    const settings = sData as SiteSettingsLite
    const cfg = settings.weekly_free_reco ?? { enabled: true, set_count: DEFAULT_COUNT }
    const ratio = Math.max(0, Math.min(100, cfg.logic_ratio ?? 100)) // 로직:랜덤 비율(현장 피드백)

    // 유료회원 지정요일 조합 SMS — 전용 토글(paid_sms) + 실발송(oneshot_enabled) + 발신번호 모두 충족 시만.
    // (무료 자동발급 cfg.enabled 와 독립 — 무료만 꺼도 유료 SMS 는 계속 동작. D68 #12)
    const smsCfg = settings.sms ?? {}
    const paidSmsOn = !!smsCfg.oneshot_enabled && !!smsCfg.sender_no && !!cfg.paid_sms
    const sender = smsCfg.sender_no ?? ''
    // 조합문자 본문 템플릿(설정 > 기본문자 템플릿 'recommend', 현장 8/28) — 발송 전 1회만 조회.
    let recoTplBody: string | null = null
    if (paidSmsOn) {
      const { data: tplData } = await sb.from('sms_templates').select('body').eq('key', 'recommend').maybeSingle()
      recoTplBody = (tplData as { body?: string } | null)?.body ?? null
    }
    // 자기 자신(/api/send-sms, /api/weekly-reco 체인)을 부를 때 쓰는 기준 주소.
    //
    // 폴백은 반드시 로컬이어야 한다. 포크 잔재로 형제 프로젝트(PlusLotto)의 운영 도메인이
    // 박혀 있었는데, VERCEL_URL 이 비는 상황이 오면 88로또의 조합문자가 플러스로또의
    // /api/send-sms 로 넘어가 **플러스로또의 발신번호·문자 계정으로** 나간다.
    // CLAUDE.md 는 두 프로젝트의 SMS 발신 계정을 완전히 분리하도록 못박고 있다.
    // 운영에서는 Vercel 이 VERCEL_URL 을 항상 넣어줘 발동한 적은 없지만, 폴백이 남의
    // 운영 도메인인 것 자체가 사고 경로다. PlusLotto 와 같은 로컬 폴백으로 맞춘다.
    const selfBase =
      process.env.SELF_BASE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')

    // 무료 자동발급도 OFF, 유료 SMS 도 OFF 면 할 일 없음 → 종료.
    if (!cfg.enabled && !paidSmsOn && !force) return res.status(200).json({ ok: true, skipped: 'disabled' })

    // PostgREST 1000행 캡 회피 — range 페이지네이션으로 전 회차 조회.
    const rounds: LottoRound[] = []
    for (let from = 0; ; from += 1000) {
      const { data: rData, error: re } = await sb.from('lotto_rounds').select('*').range(from, from + 999)
      if (re) throw re
      const page = (rData ?? []) as LottoRound[]
      rounds.push(...page)
      if (page.length < 1000) break
    }
    const targetRound = rounds.reduce((mx, r) => Math.max(mx, r.round_no), 0) + 1
    // 적재 지연 감지(D68 #13, 비차단): 최신 회차 추첨일이 8일+ 지났으면 lotto 자동적재가 밀린 상태일 수 있어
    // targetRound 가 '이미 지난 회차'를 가리킬 위험 → 발급은 막지 않되 로그로 가시화(운영 점검 신호).
    const newest = rounds.reduce<LottoRound | null>((a, r) => (!a || r.round_no > a.round_no ? r : a), null)
    const staleRound = !!newest && Date.now() - new Date(newest.draw_date).getTime() > 8 * 86400_000
    if (staleRound) {
      console.warn(`[weekly-reco] 최신 회차(${newest?.round_no}) 추첨일 8일+ 경과 — 회차 적재 지연 의심, targetRound=${targetRound}`)
    }
    const baseCount = Math.max(1, cfg.set_count || DEFAULT_COUNT)

    // ── 발송 후 누락 대조(audit=1) ───────────────────────────────────────────────
    // 2026-09-16 유료회원 951명이 조용히 누락됐고 전산은 아무것도 알려주지 않았다.
    // 발송은 하지 않고 "받아야 했는데 못 받은 회원"만 추려 로그로 남긴다. 정상 발송이 끝나면
    // 아래에서 자동으로 이 경로를 한 번 호출하고, vercel.json 크론이 백스톱으로 한 번 더 돈다
    // (발송 함수가 로그도 못 남기고 죽은 경우를 잡기 위함).
    if (auditOnly) {
      // 대조 기준 시각 = 이번 회차 발송이 시작된 시각. 이 시각 이후 가입자는 애초에 대상이
      // 아니므로 누락이 아니다. 발송 로그에 기록된 실제 시작시각을 쓰고, 로그조차 없으면
      // KST 오늘 0시로 넉넉히 잡는다 — 넓게 잡을수록 허위가 준다.
      const { data: logData } = await sb
        .from('logs')
        .select('created_at, meta')
        .eq('action', 'reco.weekly_issue')
        .eq('meta->>round_no', String(targetRound))
        .order('created_at', { ascending: true })
        .limit(1)
      const firstLog = (logData ?? [])[0] as { created_at: string; meta: Record<string, unknown> } | undefined
      const loggedStart = firstLog?.meta?.started_at
      const sinceIso =
        typeof loggedStart === 'string' && loggedStart
          ? loggedStart
          : new Date(`${kstDay(startedAt)}T00:00:00+09:00`).toISOString()

      const auditRows = await scanMembers(sb, 1000)
      const sms = await scanRecoSms(sb, sinceIso, 1000)
      const result = recoAuditMisses(auditRows, {
        today,
        force,
        autoEnabled: !!cfg.enabled,
        paidSmsOn,
        targetRound,
        sinceIso,
        smsOk: sms.ok,
        smsFail: sms.fail,
      })

      // 목록은 현장이 바로 전화할 수 있게 회원명·번호까지 남긴다. 로그 1건이 과도하게 커지지
      // 않도록 상한을 두되, 총 건수(miss_count)는 잘리지 않은 실제 값을 남긴다.
      const MISS_LOG_CAP = 300
      await sb.from('logs').insert({
        id: `log_audit_${Date.now().toString(36)}`,
        kind: 'admin',
        actor: null,
        action: 'reco.weekly_audit',
        target_type: 'member',
        target_id: null,
        meta: {
          round_no: targetRound,
          since: sinceIso,
          checked: result.checked,
          expected: result.expected,
          miss_count: result.misses.length,
          miss_not_issued: result.misses.filter((m) => m.reason === 'not_issued').length,
          miss_sms_missing: result.misses.filter((m) => m.reason === 'sms_missing').length,
          miss_sms_failed: result.misses.filter((m) => m.reason === 'sms_failed').length,
          excluded: result.excluded,
          misses: result.misses.slice(0, MISS_LOG_CAP),
          truncated: result.misses.length > MISS_LOG_CAP,
          channel: 'cron',
        },
        created_at: ts,
      })
      if (result.misses.length > 0) {
        console.warn(
          `[weekly-reco] ${targetRound}회차 발송 누락 ${result.misses.length}명 / 대상 ${result.expected}명`,
        )
      }
      return res.status(200).json({
        ok: true,
        audit: true,
        round_no: targetRound,
        checked: result.checked,
        expected: result.expected,
        miss_count: result.misses.length,
        excluded: result.excluded,
        misses: result.misses,
      })
    }
    // 등급별 고정/제외 규칙(없으면 공통 폴백) — 등급당 1회 해석 캐시.
    const excludeByGrade = new Map<string, LottoExcludeSettings>()
    const excludeFor = (grade: string): LottoExcludeSettings => {
      let e = excludeByGrade.get(grade)
      if (!e) {
        e = resolveExcludeForGrade(settings, grade)
        excludeByGrade.set(grade, e)
      }
      return e
    }

    // 전 등급 조회 — 무료=기본 금요일, 그 외 등급=발송요일 설정된 회원만(6/11 피드백).
    // 대량(15만) 대비 커서(키셋) 페이지네이션 — scanMembers 참조.
    const PAGE = 1000
    const rows: MemberScanRow[] = await scanMembers(sb, PAGE)

    // 방어선. 커서 방식이면 중복이 나올 수 없지만, 새는 순간 대가가 '유료회원 문자 두 번 +
    // 발송비 이중 지출'이라 값싼 검사를 한 겹 더 둔다.
    const seenIds = new Set<string>()
    const dupIds: string[] = []
    const uniqueRows = rows.filter((r) => {
      if (seenIds.has(r.id)) {
        dupIds.push(r.id)
        return false
      }
      seenIds.add(r.id)
      return true
    })
    if (dupIds.length > 0) {
      console.warn(
        `[weekly-reco] 대상 목록에 중복 ${dupIds.length}건 — 제거 후 진행: ${dupIds.slice(0, 10).join(', ')}`,
      )
    }

    let issued = 0
    let skippedRound = 0
    let skippedDay = 0
    let smsSent = 0
    let smsFail = 0
    let errCount = 0
    // 1) 적격 회원 선별(게이트) — CPU만, 빠름. 발급/발송은 2)에서 병렬.
    const eligible: {
      r: (typeof uniqueRows)[number]
      meta: Record<string, unknown>
      recos: WeeklyRecoIssue[]
      count: number
    }[] = []
    // 판정은 recoSkipReason 한 곳에서만 한다 — 발송 후 누락 대조와 같은 함수를 쓰기 위함.
    const gateCtx: RecoGateCtx = {
      today,
      force,
      autoEnabled: !!cfg.enabled,
      paidSmsOn,
      targetRound,
    }
    for (const r of uniqueRows) {
      const meta = r.meta ?? {}
      const skip = recoSkipReason(r, gateCtx)
      if (skip === 'day' || skip === 'paused' || skip === 'count-zero') {
        skippedDay++
        continue
      }
      if (skip === 'already') {
        skippedRound++
        continue
      }
      const recos = Array.isArray(meta.weekly_recos) ? (meta.weekly_recos as WeeklyRecoIssue[]) : []
      const count =
        typeof meta.weekly_reco_count === 'number' && (meta.weekly_reco_count as number) > 0
          ? (meta.weekly_reco_count as number)
          : baseCount
      eligible.push({ r, meta, recos, count })
    }

    // 2) 발급 + (유료)SMS — 동시성 제한 병렬. 순차로는 1000+명 발송이 함수 타임아웃(수십분)에 걸려
    //    일부만 나가던 위험을 차단(현장 6/24, 이윤선 1883명 대비). 단건 실패는 격리(잔여 진행).
    const CONC = 12
    const processOne = async ({ r, meta, recos, count }: (typeof eligible)[number]) => {
      const exclude = excludeFor(r.grade)
      // 로직 round(count×ratio%) + 완전랜덤 나머지(소스: src/lib/lottoGenerator.generateIssueSets)
      const logicCount = Math.max(0, Math.min(count, Math.round((count * ratio) / 100)))
      const sets =
        logicCount > 0
          ? generateRecommendation(rounds, exclude, { mode: 20, setCount: logicCount }).sets
          : []
      const seen = new Set(sets.map((s) => s.join('-')))
      let guard = 0
      while (sets.length < count && guard++ < count * 200) {
        const pool = Array.from({ length: LOTTO_MAX - LOTTO_MIN + 1 }, (_, i) => i + LOTTO_MIN)
        for (let i = pool.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[pool[i], pool[j]] = [pool[j], pool[i]]
        }
        const set = pool.slice(0, LOTTO_PICK).sort((a, b) => a - b)
        const k = set.join('-')
        if (seen.has(k)) continue
        seen.add(k)
        sets.push(set)
      }
      const issue: WeeklyRecoIssue = { round_no: targetRound, issued_at: ts, sets }
      const nextMeta = { ...meta, weekly_recos: [issue, ...recos].slice(0, KEEP) }
      const { error } = await sb.from('members').update({ meta: nextMeta }).eq('id', r.id)
      if (error) {
        errCount++ // 단건 실패가 잔여 회원 발급을 막지 않도록 격리(D68 #8)
        return
      }
      issued++

      // 유료회원(골드/골드+/VIP/로얄) 지정요일 조합 SMS 자동발송 — 신규 발급분만(멱등).
      if (paidSmsOn && PAID_GRADES.has(r.grade) && r.phone) {
        const smsBody = formatComboSms(r.name ?? '', targetRound, sets, recoTplBody)
        const sres = await sendComboSms(selfBase, r.phone, smsBody, sender)
        await sb.from('sms_sends').insert({
          // 병렬 동시삽입 PK 충돌 방지: 시간+난수+회원 꼬리.
          id: `sms_cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${r.id.slice(-6)}`,
          member_id: r.id,
          template_key: null,
          phone: r.phone,
          body: smsBody,
          type: 'recommend',
          status: sres.ok ? '발송완료' : `실패(${sres.code ?? '?'})`,
          sent_at: ts,
        })
        if (sres.ok) smsSent++
        else smsFail++
      }
    }
    // 유료회원 우선 처리 — 예산을 넘겨 잘리더라도 무료회원 쪽에서 잘리게 한다.
    // 유료(결제) 회원의 발급 누락이 가장 비싼 실패라서 배열 맨 앞으로 보낸다.
    eligible.sort((a, b) => Number(PAID_GRADES.has(b.r.grade)) - Number(PAID_GRADES.has(a.r.grade)))

    // 시간예산 가드 (현장 9/15 사고 — 유료회원 1,986명 중 1,035명만 발송되고 나머지 951명이
    // 발급도 로그도 없이 사라졌다). 이 함수는 vercel.json 의 maxDuration=300초에 걸리면 통째로
    // 강제 종료되는데, 그러면 뒤쪽 순서의 회원은 그날 발급·문자를 못 받고 그 사실조차 남지 않는다.
    // 예산을 넘기면 남은 대상을 남겨둔 채 정상 종료(로그 기록)하고, 이어서 처리할 후속 실행을
    // 스스로 트리거한다 — 한 번에 다 못 해도 여러 번에 나눠 반드시 완주하게 한다.
    // (재실행은 위 멱등 검사(recos[0].round_no === targetRound)로 이미 처리된 회원을 건너뛴다.)
    // 형제 프로젝트 PlusLotto 가 7/31 같은 사고 후 넣은 가드인데 이쪽에 반영되지 않아 재발했다.
    const BUDGET_MS = 240_000 // maxDuration 300초 중 안전 여유를 남긴 값
    let processed = 0
    for (let i = 0; i < eligible.length; i += CONC) {
      if (Date.now() - startedAt > BUDGET_MS) break
      const slice = eligible.slice(i, i + CONC)
      await Promise.all(slice.map(processOne))
      processed += slice.length
    }
    const remaining = Math.max(0, eligible.length - processed)

    await sb.from('logs').insert({
      id: `log_cron_${Date.now().toString(36)}`,
      kind: 'admin',
      actor: null,
      action: 'reco.weekly_issue',
      target_type: 'member',
      target_id: null,
      // started_at — 누락 대조(audit=1)가 '이 시각 이후 가입자는 대상 아님'을 판정하는 기준.
      meta: { count: issued, skipped: skippedRound, skipped_day: skippedDay, errors: errCount, round_no: targetRound, stale_round: staleRound, channel: 'cron', force, sms_sent: smsSent, sms_fail: smsFail, remaining, chain, started_at: new Date(startedAt).toISOString() },
      created_at: ts,
    })

    // 잔여분을 이어서 처리할 후속 실행을 띄운다.
    // 응답을 기다리지 않는다(자기 자신을 await 하면 이 실행이 타임아웃된다).
    const MAX_CHAIN = 20
    if (remaining > 0 && chain < MAX_CHAIN) {
      try {
        const nextUrl = `${selfBase}/api/weekly-reco?chain=${chain + 1}${force ? '&force=1' : ''}`
        await Promise.race([
          fetch(nextUrl, { method: 'GET', headers: { authorization: `Bearer ${secret}` } }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
      } catch {
        /* 후속 트리거 실패는 다음 크론 주기가 회수 — 이번 실행 결과를 실패로 만들지 않는다 */
      }
    } else if (remaining === 0) {
      // 이번 회차 처리가 끝났다 → 곧바로 누락 대조를 한 번 돌린다.
      // 별도 요청으로 띄워 이 실행이 maxDuration 에 걸리지 않게 한다. 실패해도 vercel.json 의
      // 대조 크론이 같은 날 다시 돈다.
      try {
        await Promise.race([
          fetch(`${selfBase}/api/weekly-reco?audit=1`, {
            method: 'GET',
            headers: { authorization: `Bearer ${secret}` },
          }),
          new Promise((resolve) => setTimeout(resolve, 1500)),
        ])
      } catch {
        /* 대조 트리거 실패는 대조 크론이 회수 */
      }
    }

    return res.status(200).json({ ok: true, round_no: targetRound, issued, skippedRound, skippedDay, errors: errCount, staleRound, smsSent, smsFail, remaining, chain })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return res.status(500).json({ ok: false, code: 'ERROR', message })
  }
}
