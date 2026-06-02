// 이용자 일괄작업 바 (CLAUDE §8). 선택 회원에 상태/유입분류 일괄변경,
// 담당 배정·자동할당·리셋, 문자 발송을 적용한다. 위험 작업은 확인 모달(§10).
import { useState } from 'react'
import { UserPlus, Wand2, MessageSquare, RefreshCw, Tag } from 'lucide-react'
import { BulkButton, ConfirmModal, Modal, Button } from '@/design-system/components'
import { STATUS_META } from '@/design-system/labels'
import { useStaff } from '@/lib/staff'
import type { MemberStatus } from '@/types/db'
import {
  useAssignStaff,
  useAutoAssign,
  useBulkUpdateMembers,
  useResetAssign,
  useSendSms,
  useSmsTemplates,
} from './api'

type BulkModal = 'status' | 'inflow' | 'assign' | 'auto' | 'reset' | 'sms' | null

const STATUS_VALUES: MemberStatus[] = ['active', 'suspended', 'deleted', 'withdrawn']
// TODO(live-verify): 유입분류 목록은 실 운영 코드 체계로 확정.
const INFLOW_TYPES = ['네이버검색', '페이스북', '카카오', '토스DB', '지인추천', '배너광고']

const selectCls =
  'h-9 w-full rounded-md border border-gray-300 bg-white px-2.5 text-[13px] text-gray-700 outline-none focus:border-primary-500'

export function MemberBulkActions({
  selectedIds,
  clear,
}: {
  selectedIds: string[]
  selectedRows: unknown[]
  clear: () => void
}) {
  const [modal, setModal] = useState<BulkModal>(null)
  const [statusVal, setStatusVal] = useState<MemberStatus>('active')
  const [inflowVal, setInflowVal] = useState(INFLOW_TYPES[0])
  const [staffVal, setStaffVal] = useState('')
  const [smsVal, setSmsVal] = useState('')

  const { data: staff = [] } = useStaff()
  const { data: templates = [] } = useSmsTemplates()

  const bulkUpdate = useBulkUpdateMembers()
  const assign = useAssignStaff()
  const autoAssign = useAutoAssign()
  const reset = useResetAssign()
  const sendSms = useSendSms()

  const busy =
    bulkUpdate.isPending ||
    assign.isPending ||
    autoAssign.isPending ||
    reset.isPending ||
    sendSms.isPending

  const close = () => setModal(null)
  const done = () => {
    clear()
    close()
  }

  const n = selectedIds.length

  const openSms = () => {
    setSmsVal(templates[0]?.key ?? '')
    setModal('sms')
  }
  const openAssign = () => {
    setStaffVal(staff[0]?.id ?? '')
    setModal('assign')
  }

  return (
    <>
      <BulkButton onClick={() => setModal('status')}>
        <Tag className="h-3.5 w-3.5" /> 상태변경
      </BulkButton>
      <BulkButton onClick={() => setModal('inflow')}>
        <Tag className="h-3.5 w-3.5" /> 유입분류
      </BulkButton>
      <BulkButton onClick={openAssign}>
        <UserPlus className="h-3.5 w-3.5" /> 담당배정
      </BulkButton>
      <BulkButton onClick={() => setModal('auto')}>
        <Wand2 className="h-3.5 w-3.5" /> 자동할당
      </BulkButton>
      <BulkButton onClick={() => setModal('reset')}>
        <RefreshCw className="h-3.5 w-3.5" /> 담당리셋
      </BulkButton>
      <BulkButton onClick={openSms}>
        <MessageSquare className="h-3.5 w-3.5" /> 문자발송
      </BulkButton>

      {/* 상태 일괄변경 */}
      <Modal
        open={modal === 'status'}
        onClose={close}
        title={`상태 일괄변경 · ${n}건`}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={close} disabled={busy}>
              취소
            </Button>
            <Button
              variant="pri"
              size="sm"
              disabled={busy}
              onClick={() =>
                bulkUpdate.mutate({ ids: selectedIds, patch: { status: statusVal } }, { onSuccess: done })
              }
            >
              적용
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-gray-600">변경할 상태</label>
        <select
          className={selectCls}
          value={statusVal}
          onChange={(e) => setStatusVal(e.target.value as MemberStatus)}
        >
          {STATUS_VALUES.map((s) => (
            <option key={s} value={s}>
              {STATUS_META[s].label}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11.5px] text-gray-400">정지·삭제·탈퇴는 위험 작업입니다. 신중히 적용하세요.</p>
      </Modal>

      {/* 유입분류 일괄변경 */}
      <Modal
        open={modal === 'inflow'}
        onClose={close}
        title={`유입분류 일괄변경 · ${n}건`}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={close} disabled={busy}>
              취소
            </Button>
            <Button
              variant="pri"
              size="sm"
              disabled={busy}
              onClick={() =>
                bulkUpdate.mutate(
                  { ids: selectedIds, patch: { inflow_type: inflowVal } },
                  { onSuccess: done },
                )
              }
            >
              적용
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-gray-600">유입분류</label>
        <select className={selectCls} value={inflowVal} onChange={(e) => setInflowVal(e.target.value)}>
          {INFLOW_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Modal>

      {/* 담당 배정 */}
      <Modal
        open={modal === 'assign'}
        onClose={close}
        title={`담당자 배정 · ${n}건`}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={close} disabled={busy}>
              취소
            </Button>
            <Button
              variant="pri"
              size="sm"
              disabled={busy || !staffVal}
              onClick={() => assign.mutate({ ids: selectedIds, staffId: staffVal }, { onSuccess: done })}
            >
              배정
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-gray-600">담당자</label>
        <select className={selectCls} value={staffVal} onChange={(e) => setStaffVal(e.target.value)}>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.role})
            </option>
          ))}
        </select>
      </Modal>

      {/* 문자 발송 */}
      <Modal
        open={modal === 'sms'}
        onClose={close}
        title={`문자 발송 · ${n}건`}
        size="sm"
        footer={
          <>
            <Button variant="sec" size="sm" onClick={close} disabled={busy}>
              취소
            </Button>
            <Button
              variant="acc"
              size="sm"
              disabled={busy || !smsVal}
              onClick={() => sendSms.mutate({ ids: selectedIds, templateKey: smsVal }, { onSuccess: done })}
            >
              발송
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-[12px] font-semibold text-gray-600">템플릿</label>
        <select className={selectCls} value={smsVal} onChange={(e) => setSmsVal(e.target.value)}>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.title}
            </option>
          ))}
        </select>
        <p className="mt-2 text-[11.5px] text-gray-400">
          선택한 회원에게 발송 이력이 생성되고 회원 상세 문자내역에 반영됩니다.
        </p>
      </Modal>

      {/* 자동할당 (확인) */}
      <ConfirmModal
        open={modal === 'auto'}
        onClose={close}
        onConfirm={() => autoAssign.mutate({ ids: selectedIds }, { onSuccess: done })}
        title="자동 할당"
        description={`${n}건을 활성 담당자에게 라운드로빈으로 자동 배정합니다.`}
        confirmText="자동할당"
        loading={busy}
      />

      {/* 담당리셋 (위험) */}
      <ConfirmModal
        open={modal === 'reset'}
        onClose={close}
        onConfirm={() => reset.mutate({ ids: selectedIds }, { onSuccess: done })}
        title="담당 리셋"
        description={`${n}건의 담당자를 미지정으로 되돌립니다. 매출 귀속이 변경될 수 있습니다.`}
        confirmText="담당리셋"
        tone="danger"
        loading={busy}
      />
    </>
  )
}
