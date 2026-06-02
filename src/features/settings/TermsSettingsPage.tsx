// 이용약관 편집 (/settings/terms) — 약관 본문 편집·저장.
import { useEffect, useState } from 'react'
import { usePageMeta } from '@/app/uiStore'
import { cn } from '@/lib/cn'
import { SaveBar, SectionCard, hintCls, textareaCls } from './ui'
import { useSaveSiteSettings, useSiteSettings } from './api'

export function TermsSettingsPage() {
  usePageMeta('설정', '이용약관')
  const { data: settings } = useSiteSettings()
  const save = useSaveSiteSettings()
  const [draft, setDraft] = useState<string | null>(null)

  useEffect(() => {
    if (settings) setDraft(settings.terms)
  }, [settings])

  const dirty = !!settings && draft != null && draft !== settings.terms
  const saved = save.isSuccess && !dirty

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!settings || draft == null) return
    await save.mutateAsync({ ...settings, terms: draft })
  }

  if (draft == null) return <div className="py-16 text-center text-[13px] text-gray-400">불러오는 중…</div>

  return (
    <form onSubmit={onSubmit}>
      <SectionCard title="이용약관" desc="서비스 이용약관 본문입니다. 가입·결제 화면에 노출됩니다.">
        <textarea
          rows={20}
          className={cn(textareaCls, 'text-[12.5px] leading-relaxed')}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <p className={cn(hintCls, 'mt-2')}>{draft.length.toLocaleString()}자</p>
      </SectionCard>
      <SaveBar dirty={dirty} saving={save.isPending} saved={saved} onReset={() => settings && setDraft(settings.terms)} />
    </form>
  )
}
