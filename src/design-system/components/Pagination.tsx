import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'

interface PaginationProps {
  page: number // 1-based
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

/** 윈도우형 페이지 번호 (현재 ±2). */
function pageWindow(current: number, last: number): number[] {
  const span = 2
  const start = Math.max(1, current - span)
  const end = Math.min(last, current + span)
  const out: number[] = []
  for (let i = start; i <= end; i++) out.push(i)
  return out
}

export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const last = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  const win = pageWindow(page, last)

  const btn =
    'grid h-8 min-w-8 place-items-center rounded-md px-2 text-[12.5px] font-semibold transition-colors disabled:pointer-events-none disabled:opacity-40'

  return (
    <div className={cn('flex items-center gap-2 px-1 py-2', className)}>
      <span className="text-[12px] text-gray-500 tnum">
        <b className="font-mono text-ink-800">{from.toLocaleString('ko-KR')}</b>–
        <b className="font-mono text-ink-800">{to.toLocaleString('ko-KR')}</b> /{' '}
        {total.toLocaleString('ko-KR')}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <button
          type="button"
          className={cn(btn, 'text-gray-600 hover:bg-gray-100')}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="이전 페이지"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {win[0] > 1 && (
          <>
            <button type="button" className={cn(btn, 'text-gray-600 hover:bg-gray-100')} onClick={() => onPageChange(1)}>
              1
            </button>
            {win[0] > 2 && <span className="px-1 text-gray-400">…</span>}
          </>
        )}
        {win.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onPageChange(p)}
            className={cn(
              btn,
              p === page ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {p}
          </button>
        ))}
        {win[win.length - 1] < last && (
          <>
            {win[win.length - 1] < last - 1 && <span className="px-1 text-gray-400">…</span>}
            <button type="button" className={cn(btn, 'text-gray-600 hover:bg-gray-100')} onClick={() => onPageChange(last)}>
              {last}
            </button>
          </>
        )}
        <button
          type="button"
          className={cn(btn, 'text-gray-600 hover:bg-gray-100')}
          disabled={page >= last}
          onClick={() => onPageChange(page + 1)}
          aria-label="다음 페이지"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
