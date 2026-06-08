// 추천번호 생성 (/lotto/recommend) — 운영사 「제외수 프로그램」 방식의 통계 기반 조합 생성.
// 데이터: useRounds('all')(회차 통계) + useSiteSettings(수동 고정·제외). 생성은 순수 lib/lottoGenerator.
// §8 외 부수효과 없음(읽기·계산 전용). 확률 향상 단언 없이 사실대로 안내.
import { useMemo, useState } from 'react'
import { BookOpen, Check, ChevronDown, Dices, Gift, Info, RefreshCw } from 'lucide-react'
import { Button, ConfirmModal, LottoBalls, PageHeader } from '@/design-system/components'
import { usePageMeta } from '@/app/uiStore'
import { useRole } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { datetime, num } from '@/lib/format'
import { lottoSum, oddEven } from '@/lib/lotto'
import { GRADE_LABEL } from '@/design-system/labels'
import type { Grade } from '@/types/db'
import {
  EXCLUSION_RULE_LABEL,
  MODE_OPTIONS,
  generateRecommendation,
  type ExclusionMode,
  type ExclusionRuleKey,
  type GenerateResult,
} from '@/lib/lottoGenerator'
import {
  resolveExcludeForGrade,
  useIssueWeeklyFreeReco,
  useLottoExclude,
  useRounds,
  useWeeklyFreeRecoStatus,
  WEEKLY_FREE_RECO_DEFAULT,
} from './api'

// 등급별 고정/제외 선택용(현장 피드백). null = 공통(전체 등급 공통 규칙).
const GRADE_OPTIONS: { value: Grade | null; label: string }[] = [
  { value: null, label: '공통(전체)' },
  ...(['simple', 'free', 'gold', 'goldp', 'vip', 'royal', 'ovr', 'toss'] as Grade[]).map((g) => ({
    value: g,
    label: GRADE_LABEL[g],
  })),
]

const RULE_CHIP: Record<ExclusionRuleKey, string> = {
  prev: 'bg-primary-600 text-white',
  bonus: 'bg-accent-500 text-white',
  month: 'bg-info text-white',
  freq: 'bg-gray-500 text-white',
  forties: 'bg-danger text-white',
  manual: 'bg-ink-700 text-white',
}

const NUMBERS_1_45 = Array.from({ length: 45 }, (_, i) => i + 1)
const SET_COUNTS = [1, 3, 5, 10]

// 생성 방식 설명용 텍스트(로직 원본은 lib/lottoGenerator.ts). 칩 색은 RULE_CHIP 과 동일 규칙키 사용.
const METHOD_STEPS: { rule: ExclusionRuleKey; title: string; desc: string }[] = [
  { rule: 'prev', title: '직전회차 상·하위', desc: '직전 당첨번호 6개 중 가장 큰 2개와 가장 작은 1개(총 3개)를 제외합니다.' },
  { rule: 'bonus', title: '직전 보너스', desc: '직전 회차의 보너스 번호 1개를 제외합니다.' },
  { rule: 'month', title: '월별 저출현', desc: '대상 추첨 월에 역대 출현이 가장 적었던 번호를 제외합니다.' },
  { rule: 'freq', title: '저빈도', desc: '전체 회차에서 출현이 적은 번호를 제외합니다. 대상 회차가 10의 배수면 가중합니다.' },
  { rule: 'forties', title: '40번대 과출현', desc: '최근 20회차에서 40~45 중 많이 나온 2개를 제외합니다.' },
  { rule: 'manual', title: '수동 제외 · 고정수', desc: '설정의 수동 제외수는 항상 빼고, 고정수는 항상 포함합니다.' },
]

const QUALITY_RULES = [
  '최소 3개 구간(1–9·10–19·20–29·30–39·40–45)에 분산',
  '한 구간에 4개 이상 몰린 조합은 제외',
  '전부 홀수 또는 전부 짝수인 조합은 제외',
  '3연번 이상이거나 연속쌍이 2개 이상인 조합은 제외',
  '번호 합이 역대 분포의 권장 밴드(약 10~90 분위) 안',
  '역대 1등과 동일한 조합은 제외',
]

export function RecommendPage() {
  usePageMeta('추천번호', '통계 기반 제외수 · 추천 조합')
  const role = useRole()
  const { data: rounds = [], isLoading } = useRounds('all')
  const { data: settings } = useLottoExclude()
  const { data: freeStatus } = useWeeklyFreeRecoStatus()
  const issueWeekly = useIssueWeeklyFreeReco()
  const [confirmIssue, setConfirmIssue] = useState(false)
  const [issueMsg, setIssueMsg] = useState<string | null>(null)

  const recoCfg = settings?.weekly_free_reco ?? WEEKLY_FREE_RECO_DEFAULT
  const canIssue = role === 'admin' || role === 'manager'

  const [grade, setGrade] = useState<Grade | null>(null)
  const [mode, setMode] = useState<ExclusionMode>(20)
  const [setCount, setSetCount] = useState(5)
  const [result, setResult] = useState<GenerateResult | null>(null)
  const [showMethod, setShowMethod] = useState(false)

  // 선택 등급에 적용되는 고정/제외(등급 규칙 없으면 공통 → 레거시 폴백).
  const exclude = useMemo(
    () => (settings ? resolveExcludeForGrade(settings, grade) : null),
    [settings, grade],
  )

  const ready = !isLoading && !!exclude && rounds.length > 0

  // 번호 → 제외 사유 규칙(칩 색 매핑).
  const ruleByNumber = useMemo(() => {
    const m = new Map<number, ExclusionRuleKey>()
    if (result) for (const r of result.reasons) m.set(r.number, r.rule)
    return m
  }, [result])

  function onGenerate() {
    if (!exclude) return
    setResult(generateRecommendation(rounds, exclude, { mode, setCount }))
  }

  return (
    <div>
      <PageHeader
        title="추천번호 생성"
        description="과거 회차 통계로 제외수를 산정하고, 남은 번호에서 패턴 품질을 통과한 6/45 조합을 추천합니다."
      />

      {/* 무료회원 주간 발급 (현장 피드백) */}
      <div className="mb-4 rounded-lg border border-accent-100 bg-accent-50/60 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-accent-600" />
            <div>
              <h3 className="text-[13.5px] font-bold text-ink-900">무료회원 주간 발급</h3>
              <p className="text-[11.5px] text-gray-500">
                매주 금요일 09:00 자동 발급 · 문자 발송 없음 · 홈페이지(전화번호/뒷4자리)에서 조회
              </p>
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-4 text-[12px]">
            <span className="text-gray-500">
              대상 무료회원{' '}
              <b className="font-mono tnum text-ink-800">{num(freeStatus?.freeCount ?? 0)}</b>명
            </span>
            <span className="text-gray-500">
              발급 조합{' '}
              <b className="font-mono tnum text-ink-800">{recoCfg.set_count}</b>세트
            </span>
            <span className="text-gray-500">
              최근 발급{' '}
              {freeStatus?.lastRound ? (
                <b className="font-mono tnum text-ink-800">
                  {freeStatus.lastRound}회 · {freeStatus.lastIssuedAt ? datetime(freeStatus.lastIssuedAt) : '-'}
                </b>
              ) : (
                <b className="text-gray-400">없음</b>
              )}
            </span>
            {canIssue && (
              <Button
                variant="acc"
                size="sm"
                icon={<Gift className="h-4 w-4" />}
                disabled={issueWeekly.isPending}
                onClick={() => setConfirmIssue(true)}
              >
                지금 발급
              </Button>
            )}
          </div>
        </div>
        {issueMsg && <p className="mt-2 text-[12px] font-semibold text-success">{issueMsg}</p>}
      </div>

      <ConfirmModal
        open={confirmIssue}
        onClose={() => setConfirmIssue(false)}
        onConfirm={() => {
          setIssueMsg(null)
          issueWeekly.mutate(undefined, {
            onSuccess: (r) => {
              setConfirmIssue(false)
              setIssueMsg(
                `${r.round_no}회 · ${r.issued.toLocaleString('ko-KR')}명 발급 완료${r.skipped ? ` (이미 발급 ${r.skipped}명 제외)` : ''}.`,
              )
            },
          })
        }}
        title="무료회원 주간 발급"
        description={`무료회원 전원에게 ${recoCfg.set_count}조합을 발급합니다(문자 발송 없음). 이미 이번 회차를 받은 회원은 자동으로 건너뜁니다.`}
        confirmText="발급"
        tone="primary"
        loading={issueWeekly.isPending}
      />

      {/* 정직성 안내 */}
      <div className="mb-4 flex items-start gap-2 rounded-lg border border-info-bd bg-info-bg px-3.5 py-2.5 text-[12.5px] text-ink-700">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
        <p>
          6/45 모든 6개 조합의 1등 확률은 <b className="font-mono tnum">1/8,145,060</b> 로 동일합니다. 본
          기능은 운영 기준(제외수)에 따라 <b>제시할 조합을 선별</b>할 뿐, 당첨 확률을 높이지 않습니다.
        </p>
      </div>

      {/* 생성 방식 설명 (접이식) */}
      <div className="mb-4 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <button
          type="button"
          onClick={() => setShowMethod((v) => !v)}
          aria-expanded={showMethod}
          className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-gray-50"
        >
          <BookOpen className="h-4 w-4 shrink-0 text-primary-600" />
          <span className="text-[13px] font-bold text-ink-900">
            생성 방식 — 제외수 산정과 조합 품질 필터
          </span>
          <span className="ml-auto text-[11.5px] text-gray-400">{showMethod ? '접기' : '자세히'}</span>
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform', showMethod && 'rotate-180')}
          />
        </button>

        {showMethod && (
          <div className="border-t border-gray-100 px-4 py-3.5 text-[12.5px] leading-relaxed text-ink-700">
            <p className="mb-3 text-gray-600">
              과거 회차 통계로 <b>제외수</b>를 산정하고, 남은 번호 풀에서 패턴 품질을 통과한 6/45 조합만
              제시합니다. 제외수 개수(10·15·20)는 위 컨트롤에서 선택합니다.
            </p>

            <h4 className="mb-2 text-[12px] font-bold text-ink-900">1. 제외수 산정 규칙</h4>
            <ul className="mb-2 space-y-1.5">
              {METHOD_STEPS.map((s) => (
                <li key={s.rule} className="flex items-start gap-2">
                  <span
                    className={cn('mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full', RULE_CHIP[s.rule])}
                  />
                  <span>
                    <b className="text-ink-800">{s.title}</b> — {s.desc}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mb-3.5 text-[11.5px] text-gray-500">
              위 후보를 우선순위로 정렬해 선택한 개수만큼 압축합니다. 데이터가 적으면 절대 기준 대신 순위
              기반으로 압축합니다.
            </p>

            <h4 className="mb-2 text-[12px] font-bold text-ink-900">2. 조합 품질 필터</h4>
            <ul className="mb-2 grid gap-1.5 sm:grid-cols-2">
              {QUALITY_RULES.map((q) => (
                <li key={q} className="flex items-start gap-2">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{q}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11.5px] text-gray-500">남은 풀이 좁으면 일부 필터를 완화해 생성합니다.</p>

            <div className="mt-3.5 flex items-start gap-2 rounded-md bg-gray-50 px-3 py-2 text-[11.5px] text-gray-600">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
              <span>
                제외수는 통계적 <b>선별 기준</b>일 뿐입니다. 모든 6개 조합의 1등 확률(
                <span className="font-mono tnum">1/8,145,060</span>)은 동일하며, 본 기능이 당첨 확률을
                높이지는 않습니다.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 컨트롤 */}
      <div className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-gray-200 bg-white p-4">
        <div>
          <div className="mb-1 text-[11.5px] font-semibold text-gray-500">대상 등급</div>
          <select
            value={grade ?? ''}
            onChange={(e) => {
              setGrade((e.target.value || null) as Grade | null)
              setResult(null) // 등급 바뀌면 이전 결과 무효
            }}
            className="h-9 rounded-md border border-gray-300 bg-white px-2.5 text-[12.5px] font-semibold text-gray-700 outline-none focus:border-primary-500"
          >
            {GRADE_OPTIONS.map((o) => (
              <option key={o.value ?? 'common'} value={o.value ?? ''}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <div className="mb-1 text-[11.5px] font-semibold text-gray-500">제외수 개수</div>
          <div className="inline-flex rounded-md border border-gray-200 p-0.5">
            {MODE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cn(
                  'rounded px-3 py-1.5 text-[12.5px] font-semibold tabular-nums transition',
                  mode === m ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                {m}개
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 text-[11.5px] font-semibold text-gray-500">추천 세트 수</div>
          <div className="inline-flex rounded-md border border-gray-200 p-0.5">
            {SET_COUNTS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setSetCount(c)}
                className={cn(
                  'rounded px-3 py-1.5 text-[12.5px] font-semibold tabular-nums transition',
                  setCount === c ? 'bg-ink-700 text-white' : 'text-gray-600 hover:bg-gray-100',
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <Button
          variant="pri"
          icon={result ? <RefreshCw className="h-4 w-4" /> : <Dices className="h-4 w-4" />}
          onClick={onGenerate}
          disabled={!ready}
        >
          {result ? '다시 생성' : '번호 생성'}
        </Button>
        {!ready && (
          <span className="text-[12px] text-gray-400">
            {isLoading ? '회차 데이터 불러오는 중…' : '회차 데이터가 없어 생성할 수 없습니다.'}
          </span>
        )}
      </div>

      {result && <ResultView result={result} ruleByNumber={ruleByNumber} />}
    </div>
  )
}

function ResultView({
  result,
  ruleByNumber,
}: {
  result: GenerateResult
  ruleByNumber: Map<number, ExclusionRuleKey>
}) {
  const usedRules = useMemo(() => {
    const s = new Set<ExclusionRuleKey>()
    for (const r of result.reasons) s.add(r.rule)
    return [...s]
  }, [result])

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      {/* ── 제외수 + 근거 ── */}
      <div className="space-y-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-[14px] font-bold text-ink-900">
              제외수 <span className="font-mono tnum text-danger">{result.excluded.length}</span>개
            </h3>
            <span className="text-[11.5px] text-gray-400">
              남은 풀 <span className="font-mono tnum">{result.pool.length}</span>
            </span>
          </div>

          <div className="grid grid-cols-9 gap-1.5">
            {NUMBERS_1_45.map((n) => {
              const rule = ruleByNumber.get(n)
              const fixed = result.fixed.includes(n)
              return (
                <div
                  key={n}
                  title={fixed ? '고정수' : rule ? EXCLUSION_RULE_LABEL[rule] : '후보 풀'}
                  className={cn(
                    'grid aspect-square place-items-center rounded-full text-[12px] font-bold tabular-nums',
                    fixed
                      ? 'bg-success text-white ring-2 ring-success-bd'
                      : rule
                        ? cn(RULE_CHIP[rule], 'line-through opacity-90')
                        : 'bg-gray-100 text-gray-500',
                  )}
                >
                  {n}
                </div>
              )
            })}
          </div>

          {/* 범례 */}
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 text-[11px] text-gray-600">
            {usedRules.map((r) => (
              <span key={r} className="flex items-center gap-1.5">
                <span className={cn('h-3 w-3 rounded-full', RULE_CHIP[r])} />
                {EXCLUSION_RULE_LABEL[r]}
              </span>
            ))}
            {result.fixed.length > 0 && (
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-success" /> 고정수
              </span>
            )}
          </div>
        </div>

        {/* 근거 요약 */}
        <div className="rounded-lg border border-gray-200 bg-white p-4 text-[12.5px]">
          <h3 className="mb-2 text-[13px] font-bold text-ink-900">산정 근거</h3>
          <dl className="space-y-1.5 text-gray-600">
            <Row label="대상 회차">
              <span className="font-mono tnum text-ink-800">{num(result.targetRound)}</span>회 (
              {result.drawMonth}월 추첨 기준)
            </Row>
            <Row label="사용 회차수">
              <span className="font-mono tnum text-ink-800">{num(result.basis.roundsUsed)}</span>회
            </Row>
            {result.basis.prevNumbers && (
              <div className="flex items-center gap-2 pt-0.5">
                <dt className="w-[64px] shrink-0 text-gray-400">직전 {result.basis.prevRound}회</dt>
                <dd>
                  <LottoBalls
                    numbers={result.basis.prevNumbers}
                    bonus={result.basis.prevBonus}
                    size="sm"
                  />
                </dd>
              </div>
            )}
            <Row label="합 권장">
              <span className="font-mono tnum text-ink-800">
                {result.basis.sumBand[0]}–{result.basis.sumBand[1]}
              </span>
            </Row>
          </dl>
          {result.basis.relaxed && (
            <p className="mt-2 text-[11px] text-warning">
              ※ 남은 풀이 좁아 일부 패턴 필터를 완화해 생성했습니다.
            </p>
          )}
        </div>
      </div>

      {/* ── 추천 조합 ── */}
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-[14px] font-bold text-ink-900">
          추천 조합 <span className="font-mono tnum text-primary-600">{result.sets.length}</span>세트
        </h3>
        {result.sets.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-gray-400">
            조건을 만족하는 조합을 만들 수 없습니다. 제외수를 줄이거나 설정을 확인하세요.
          </p>
        ) : (
          <ul className="space-y-2">
            {result.sets.map((set, i) => (
              <li
                key={set.join('-')}
                className="flex flex-wrap items-center gap-3 rounded-md border border-gray-100 bg-gray-50 px-3 py-2"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-ink-700 text-[11px] font-bold text-white tabular-nums">
                  {String.fromCharCode(65 + i)}
                </span>
                <LottoBalls numbers={set} size="md" highlight={result.fixed} />
                <span className="ml-auto flex items-center gap-3 font-mono text-[11.5px] text-gray-500 tnum">
                  <span>합 {lottoSum(set)}</span>
                  <span>홀짝 {oddEven(set)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {result.fixed.length > 0 && (
          <p className="mt-3 text-[11px] text-gray-400">
            ● 강조 번호는 설정의 고정수입니다(모든 세트에 포함).
          </p>
        )}
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <dt className="w-[64px] shrink-0 text-gray-400">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
