import { useState, type ReactNode } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface FilterChip {
  key: string
  label: string
  onRemove: () => void
}

interface FilterBarProps {
  searchValue: string
  onSearchChange: (v: string) => void
  searchPlaceholder?: string
  chips?: FilterChip[]
  onClearAll?: () => void
  /** 접이식 패널 내용(필터 컨트롤). */
  children?: ReactNode
  className?: string
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'ID · 이름 · 핸드폰 검색',
  chips = [],
  onClearAll,
  children,
  className,
}: FilterBarProps) {
  const [open, setOpen] = useState(false)
  const hasChips = chips.length > 0

  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white', className)}>
      <div className="flex flex-wrap items-center gap-2 p-2.5">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-md border border-gray-300 bg-white pl-8 pr-8 text-[13px] text-gray-700 outline-none placeholder:text-gray-400 focus:border-primary-500"
          />
          {searchValue && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              aria-label="검색어 지우기"
              className="absolute right-2 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {children && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[12.5px] font-semibold transition-colors',
              open
                ? 'border-primary-500 bg-primary-50 text-primary-700'
                : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            필터
            {hasChips && (
              <span className="rounded-full bg-primary-600 px-1.5 text-[10px] font-bold text-white tnum">
                {chips.length}
              </span>
            )}
          </button>
        )}
      </div>

      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-100 px-2.5 py-2">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full border border-primary-100 bg-primary-50 py-1 pl-2.5 pr-1 text-[11.5px] font-semibold text-primary-700"
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                aria-label={`${chip.label} 해제`}
                className="grid h-4 w-4 place-items-center rounded-full text-primary-600 hover:bg-primary-100"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          {onClearAll && (
            <button
              type="button"
              onClick={onClearAll}
              className="ml-1 text-[11.5px] font-semibold text-gray-500 underline-offset-2 hover:text-gray-700 hover:underline"
            >
              전체 초기화
            </button>
          )}
        </div>
      )}

      {open && children && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-3">{children}</div>
      )}
    </div>
  )
}
