import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: number
}

/** 우측 슬라이드 패널 (상세/편집 허브 — 회원 Drawer 등). */
export function Drawer({ open, onClose, title, children, footer, width = 560 }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-ink-900/40 backdrop-blur-[1px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full flex-col border-l border-gray-200 bg-white shadow-lg"
        style={{ width }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
          <div className="min-w-0 text-[15px] font-bold text-ink-900">{title}</div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={cn('min-h-0 flex-1 overflow-y-auto px-5 py-4')}>{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
