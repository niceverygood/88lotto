// 로또 고정·제외 설정 (/settings/lotto-exclude) — 회차별 고정/제외 입력(효력일자) + 이력(§V2-5).
// 토요일 입력 → 익주 월요일(effective_from)부터 적용. 활성 규칙은 추천 생성(useLottoExclude)에 반영.
import { useEffect, useMemo, useState } from 'react'
import type { LottoExcludeRule, SiteSettings } from '@/types/db'
import { Button } from '@/design-system/components'
import { usePageMeta } from '@/app/uiStore'
import { datetime } from '@/lib/format'
import { genId } from '@/lib/db/store'
import { useCurrentUser } from '@/lib/auth'
import { cn } from '@/lib/cn'
import { SectionCard } from './ui'
import { useSaveSiteSettings, useSiteSettings } from './api'

type Mode = 'fixed' | 'excluded'
const NUMBERS = Array.from({ length: 45 }, (_, i) => i + 1)
const fieldCls =
  'h-9 w-[160px] rounded-md border border-gray-300 bg-white px-2.5 text-[13px] text-gray-700 outline-none focus:border-primary-500'

function fmtLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
// 익주 월요일(토요일 입력 시 이틀 뒤). 오늘이 월요일이면 다음 주 월요일.
function nextMonday(): string {
  const d = new Date()
  const add = (8 - d.getDay()) % 7 || 7
  d.setDate(d.getDate() + add)
  return fmtLocal(d)
}

export function LottoExcludePage() {
  usePageMeta('설정', '로또 고정·제외')
  const me = useCurrentUser()
  const { data: settings } = useSiteSettings()
  const save = useSaveSiteSettings()

  const [fixed, setFixed] = useState<number[]>([])
  const [excluded, setExcluded] = useState<number[]>([])
  const [mode, setMode] = useState<Mode>('fixed')
  const [roundNo, setRoundNo] = useState('')
  const [effectiveFrom, setEffectiveFrom] = useState(nextMonday())

  const today = fmtLocal(new Date())
  const history = useMemo(
    () =>
      [...(settings?.lotto_exclude_history ?? [])].sort(
        (a, b) => b.effective_from.localeCompare(a.effective_from) || b.round_no - a.round_no,
      ),
    [settings],
  )
  // 활성(적용중) 규칙 id = effective_from<=오늘 중 최신(이력은 desc 정렬).
  const activeId = useMemo(() => history.find((r) => r.effective_from <= today)?.id ?? null, [history, today])

  // 기본 적용 회차 = 최신 이력 회차 + 1
  useEffect(() => {
    if (settings && !roundNo) {
      const maxRound = (settings.lotto_exclude_history ?? []).reduce((mx, r) => Math.max(mx, r.round_no), 0)
      if (maxRound) setRoundNo(String(maxRound + 1))
    }
  }, [settings]) // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(n: number) {
    if (mode === 'fixed') {
      setFixed((f) => (f.includes(n) ? f.filter((x) => x !== n) : [...f, n].sort((a, b) => a - b)))
      setExcluded((e) => e.filter((x) => x !== n))
    } else {
      setExcluded((e) => (e.includes(n) ? e.filter((x) => x !== n) : [...e, n].sort((a, b) => a - b)))
      setFixed((f) => f.filter((x) => x !== n))
    }
  }

  const canAdd = !!settings && /^\d+$/.test(roundNo) && (fixed.length > 0 || excluded.length > 0)

  async function onAddRule() {
    if (!settings || !canAdd) return
    const rule: LottoExcludeRule = {
      id: genId('lxr'),
      round_no: Number(roundNo),
      fixed: [...fixed],
      excluded: [...excluded],
      effective_from: effectiveFrom,
      created_at: new Date().toISOString(),
      created_by: me?.id ?? null,
    }
    const nextHistory = [...(settings.lotto_exclude_history ?? []), rule]
    // 현재 적용 스냅샷(폴백) = effective_from<=오늘 중 최신
    const applicable = nextHistory
      .filter((r) => r.effective_from <= today)
      .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
    const snapshot = applicable[0]
      ? { fixed: applicable[0].fixed, excluded: applicable[0].excluded }
      : settings.lotto_exclude
    const next: SiteSettings = { ...settings, lotto_exclude_history: nextHistory, lotto_exclude: snapshot }
    await save.mutateAsync(next)
    setFixed([])
    setExcluded([])
    setRoundNo(String(rule.round_no + 1))
    setEffectiveFrom(nextMonday())
  }

  if (!settings) return <div className="py-16 text-center text-[13px] text-gray-400">불러오는 중…</div>

  return (
    <div className="space-y-4">
      <SectionCard
        title="고정·제외 입력 (회차 예약)"
        desc="이번 회차의 고정수/제외수를 선택하고 적용 회차·시작일을 지정해 이력에 추가합니다. 토요일에 입력하면 익주 월요일부터 적용됩니다."
      >
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-gray-500">적용 회차</span>
            <input
              className={fieldCls}
              inputMode="numeric"
              placeholder="예: 1181"
              value={roundNo}
              onChange={(e) => setRoundNo(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11.5px] font-semibold text-gray-500">적용 시작일</span>
            <input
              type="date"
              className={fieldCls}
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
            />
          </label>
          <span className="pb-2 text-[11.5px] text-gray-400">
            {effectiveFrom > today ? '예정 — 시작일부터 자동 적용' : '오늘부터 적용'}
          </span>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-gray-200 p-0.5">
            <button
              type="button"
              onClick={() => setMode('fixed')}
              className={cn(
                'rounded px-3 py-1.5 text-[12.5px] font-semibold transition',
                mode === 'fixed' ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              고정수 추가
            </button>
            <button
              type="button"
              onClick={() => setMode('excluded')}
              className={cn(
                'rounded px-3 py-1.5 text-[12.5px] font-semibold transition',
                mode === 'excluded' ? 'bg-danger text-white' : 'text-gray-600 hover:bg-gray-100',
              )}
            >
              제외수 추가
            </button>
          </div>
          <span className="ml-auto flex items-center gap-3 text-[11.5px] text-gray-500">
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-primary-600" /> 고정 {fixed.length}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-danger" /> 제외 {excluded.length}
            </span>
            <button
              type="button"
              className="text-gray-400 hover:underline disabled:opacity-40"
              onClick={() => {
                setFixed([])
                setExcluded([])
              }}
              disabled={!fixed.length && !excluded.length}
            >
              전체 해제
            </button>
          </span>
        </div>

        <div className="grid grid-cols-9 gap-1.5">
          {NUMBERS.map((n) => {
            const isF = fixed.includes(n)
            const isE = excluded.includes(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggle(n)}
                className={cn(
                  'grid aspect-square place-items-center rounded-full text-[12.5px] font-bold tabular-nums transition',
                  isF
                    ? 'bg-primary-600 text-white'
                    : isE
                      ? 'bg-danger text-white line-through'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {n}
              </button>
            )
          })}
        </div>

        <div className="mt-3 flex justify-end">
          <Button variant="pri" size="sm" disabled={!canAdd || save.isPending} onClick={onAddRule}>
            이력에 추가
          </Button>
        </div>
      </SectionCard>

      <SectionCard
        title="회차별 고정·제외 이력"
        desc="회차마다 적용된 고정/제외 번호 기록입니다. ‘적용중’ 규칙이 추천 생성에 반영됩니다."
      >
        {history.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-gray-400">아직 등록된 이력이 없습니다.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="border-b border-gray-100 bg-gray-50 text-[11px] font-bold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-2.5 py-2">회차</th>
                  <th className="px-2.5 py-2">적용 시작</th>
                  <th className="px-2.5 py-2">상태</th>
                  <th className="px-2.5 py-2">고정수</th>
                  <th className="px-2.5 py-2">제외수</th>
                  <th className="px-2.5 py-2 text-right">등록</th>
                </tr>
              </thead>
              <tbody>
                {history.map((r) => {
                  const status = r.effective_from > today ? '예정' : r.id === activeId ? '적용중' : '이전'
                  const tone =
                    status === '적용중'
                      ? 'bg-success-bg text-success'
                      : status === '예정'
                        ? 'bg-warning-bg text-warning'
                        : 'bg-gray-100 text-gray-500'
                  return (
                    <tr key={r.id} className="border-t border-gray-100">
                      <td className="px-2.5 py-2 font-mono tnum font-semibold text-ink-800">{r.round_no}회</td>
                      <td className="px-2.5 py-2 font-mono tnum text-gray-600">{r.effective_from}</td>
                      <td className="px-2.5 py-2">
                        <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', tone)}>
                          {status}
                        </span>
                      </td>
                      <td className="px-2.5 py-2 font-mono tnum text-primary-700">
                        {r.fixed.length ? r.fixed.join(', ') : '—'}
                      </td>
                      <td className="px-2.5 py-2 font-mono tnum text-danger">
                        {r.excluded.length ? r.excluded.join(', ') : '—'}
                      </td>
                      <td className="px-2.5 py-2 text-right text-[11px] text-gray-400">{datetime(r.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
