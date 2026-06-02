// 로또 고정·제외 설정 (/settings/lotto-exclude) — 추천 번호에 항상 포함(고정)/항상 제외할 번호.
// TODO(live-verify): 추천 엔진 연동 규칙 미확인 → 설정만 보관(ASSUMPTIONS).
import { useEffect, useState } from 'react'
import type { LottoExcludeSettings } from '@/types/db'
import { Button } from '@/design-system/components'
import { usePageMeta } from '@/app/uiStore'
import { cn } from '@/lib/cn'
import { SaveBar, SectionCard } from './ui'
import { useSaveSiteSettings, useSiteSettings } from './api'

type Mode = 'fixed' | 'excluded'
const NUMBERS = Array.from({ length: 45 }, (_, i) => i + 1)

export function LottoExcludePage() {
  usePageMeta('설정', '로또 고정·제외')
  const { data: settings } = useSiteSettings()
  const save = useSaveSiteSettings()
  const [draft, setDraft] = useState<LottoExcludeSettings | null>(null)
  const [mode, setMode] = useState<Mode>('fixed')

  useEffect(() => {
    if (settings) setDraft(structuredClone(settings.lotto_exclude))
  }, [settings])

  const dirty = !!settings && !!draft && JSON.stringify(draft) !== JSON.stringify(settings.lotto_exclude)
  const saved = save.isSuccess && !dirty

  function toggle(n: number) {
    setDraft((d) => {
      if (!d) return d
      const fixed = new Set(d.fixed)
      const excluded = new Set(d.excluded)
      if (mode === 'fixed') {
        if (fixed.has(n)) fixed.delete(n)
        else {
          fixed.add(n)
          excluded.delete(n)
        }
      } else {
        if (excluded.has(n)) excluded.delete(n)
        else {
          excluded.add(n)
          fixed.delete(n)
        }
      }
      return {
        fixed: [...fixed].sort((a, b) => a - b),
        excluded: [...excluded].sort((a, b) => a - b),
      }
    })
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!settings || !draft) return
    await save.mutateAsync({ ...settings, lotto_exclude: draft })
  }

  if (!draft) return <div className="py-16 text-center text-[13px] text-gray-400">불러오는 중…</div>

  return (
    <form onSubmit={onSubmit}>
      <SectionCard
        title="로또 고정·제외 번호"
        desc="추천 번호에 항상 포함할 고정수와, 항상 제외할 제외수를 지정합니다."
        action={
          <Button
            variant="gho"
            size="sm"
            onClick={() => setDraft({ fixed: [], excluded: [] })}
            disabled={draft.fixed.length === 0 && draft.excluded.length === 0}
          >
            전체 해제
          </Button>
        }
      >
        {/* 모드 토글 + 범례 */}
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
              <span className="h-3 w-3 rounded-full bg-primary-600" /> 고정 {draft.fixed.length}
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-full bg-danger" /> 제외 {draft.excluded.length}
            </span>
          </span>
        </div>

        {/* 1..45 그리드 */}
        <div className="grid grid-cols-9 gap-1.5">
          {NUMBERS.map((n) => {
            const isFixed = draft.fixed.includes(n)
            const isExcluded = draft.excluded.includes(n)
            return (
              <button
                key={n}
                type="button"
                onClick={() => toggle(n)}
                className={cn(
                  'grid aspect-square place-items-center rounded-full text-[12.5px] font-bold tabular-nums transition',
                  isFixed
                    ? 'bg-primary-600 text-white'
                    : isExcluded
                      ? 'bg-danger text-white line-through'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
                )}
              >
                {n}
              </button>
            )
          })}
        </div>
      </SectionCard>
      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        saved={saved}
        onReset={() => settings && setDraft(structuredClone(settings.lotto_exclude))}
      />
    </form>
  )
}
