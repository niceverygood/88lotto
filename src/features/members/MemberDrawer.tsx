// 회원 상세 Drawer — §8 교차연동 허브. 탭(기본정보·결제내역·문자내역·배정이력·메모) +
// 액션(등급변경·담당변경·정지·아웃콜·문자발송). 모든 액션은 api 뮤테이션 →
// 관련 쿼리 무효화 + 로그/배정/문자 부수효과를 만든다.
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { MessageSquare, Send } from 'lucide-react'
import {
  Badge,
  Button,
  ConfirmModal,
  Drawer,
  LottoBalls,
  StatusChip,
  Tabs,
  type TabItem,
} from '@/design-system/components'
import { GRADE_LABEL, PAYMENT_METHOD_LABEL, SMS_TYPE_LABEL } from '@/design-system/labels'
import { date, datetime, krw, phone } from '@/lib/format'
import { useStaff, useTeams } from '@/lib/staff'
import { useRole } from '@/lib/auth'
import { homepageId, homepagePw } from '@/lib/homepage'
import type { Grade, WeeklyRecoIssue } from '@/types/db'
import {
  readMemos,
  useAddMemo,
  useAssignStaff,
  useMember,
  useMemberAssignments,
  useMemberPayments,
  useMemberSms,
  useProducts,
  useResetAssign,
  useSendSms,
  useSmsTemplates,
  useUpdateMember,
  type ResetMemo,
} from './api'

const GRADES: Grade[] = ['simple', 'free', 'gold', 'goldp', 'vip', 'royal', 'ovr', 'toss']
type DrawerTab = 'info' | 'payments' | 'sms' | 'assignments' | 'memo' | 'reco'

function readWeeklyRecos(meta: Record<string, unknown> | undefined): WeeklyRecoIssue[] {
  const list = meta?.weekly_recos as WeeklyRecoIssue[] | undefined
  return Array.isArray(list) ? list : []
}

const selectCls =
  'h-8 rounded-md border border-gray-300 bg-white px-2 text-[12px] text-gray-700 outline-none focus:border-primary-500'

export function MemberDrawer({ memberId, onClose }: { memberId: string | null; onClose: () => void }) {
  const open = !!memberId
  const { data: member } = useMember(memberId)
  const { data: payments = [] } = useMemberPayments(memberId)
  const { data: sms = [] } = useMemberSms(memberId)
  const { data: assignments = [] } = useMemberAssignments(memberId)
  const { data: staff = [] } = useStaff()
  const { data: teams = [] } = useTeams()
  const { data: products = [] } = useProducts()
  const { data: templates = [] } = useSmsTemplates()

  const role = useRole()
  const updateMember = useUpdateMember()
  const addMemo = useAddMemo()
  const assignStaff = useAssignStaff()
  const resetAssign = useResetAssign()
  const sendSms = useSendSms()

  const [tab, setTab] = useState<DrawerTab>('info')
  const [memoDraft, setMemoDraft] = useState('')
  const [smsTpl, setSmsTpl] = useState('')
  const [confirmSuspend, setConfirmSuspend] = useState(false)

  useEffect(() => {
    setMemoDraft('') // 새 콜메모 입력칸(리스트형 누적) — 회원 전환 시 비움
    setTab('info')
  }, [member?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (templates.length && !smsTpl) setSmsTpl(templates[0].key)
  }, [templates, smsTpl])

  const staffName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const s of staff) m[s.id] = s.name
    return m
  }, [staff])
  const teamName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const t of teams) m[t.id] = t.name
    return m
  }, [teams])
  const productName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of products) m[p.id] = p.name
    return m
  }, [products])

  if (!member) {
    return (
      <Drawer open={open} onClose={onClose} title="회원 상세">
        <div className="py-10 text-center text-[12.5px] text-gray-400">불러오는 중…</div>
      </Drawer>
    )
  }
  const id = member.id

  const tabs: TabItem[] = [
    { key: 'info', label: '기본정보' },
    { key: 'payments', label: '결제내역', count: payments.length },
    { key: 'sms', label: '문자내역', count: sms.length },
    { key: 'assignments', label: '배정이력', count: assignments.length },
    { key: 'memo', label: '메모', count: readMemos(member).length || undefined },
    { key: 'reco', label: '발급번호', count: readWeeklyRecos(member.meta).length || undefined },
  ]

  const title = (
    <div className="flex min-w-0 items-center gap-2">
      <span className="truncate font-bold text-ink-900">{member.name}</span>
      <span className="font-mono text-[12px] font-normal text-gray-400">{member.user_id}</span>
      <Badge grade={member.grade} />
      <StatusChip status={member.status} />
    </div>
  )

  return (
    <Drawer open={open} onClose={onClose} title={title} width={620}>
      {/* 빠른 액션 */}
      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-2.5">
        <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-500">
          등급
          <select
            className={selectCls}
            value={member.grade}
            onChange={(e) => updateMember.mutate({ id, patch: { grade: e.target.value as Grade } })}
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                {GRADE_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-500">
          담당
          <select
            className={selectCls}
            value={member.assigned_staff_id ?? ''}
            onChange={(e) =>
              e.target.value
                ? assignStaff.mutate({ ids: [id], staffId: e.target.value })
                : resetAssign.mutate({ ids: [id] })
            }
          >
            <option value="">미지정</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant={member.outcall_done ? 'sec' : 'acc'}
            onClick={() => updateMember.mutate({ id, patch: { outcall_done: !member.outcall_done } })}
          >
            {member.outcall_done ? '아웃콜 완료' : '아웃콜 처리'}
          </Button>
          {member.status === 'suspended' ? (
            <Button size="sm" variant="suc" onClick={() => updateMember.mutate({ id, patch: { status: 'active' } })}>
              정지해제
            </Button>
          ) : (
            <Button size="sm" variant="dng" onClick={() => setConfirmSuspend(true)}>
              정지
            </Button>
          )}
        </div>
      </div>

      <Tabs tabs={tabs} value={tab} onChange={(k) => setTab(k as DrawerTab)} className="mb-4" />

      {tab === 'info' && (
        <dl className="grid grid-cols-2 gap-x-5 gap-y-3">
          <Row label="이름">{member.name}</Row>
          <Row label="닉네임">{member.nickname ?? '-'}</Row>
          <Row label="로그인 ID" mono>
            {member.user_id}
          </Row>
          <Row label="핸드폰" mono>
            {phone(member.phone)}
          </Row>
          <Row label="등급">
            <Badge grade={member.grade} />
          </Row>
          <Row label="상태">
            <StatusChip status={member.status} />
          </Row>
          <Row label="성향">{member.tendency ?? '-'}</Row>
          <Row label="아웃콜">{member.outcall_done ? '완료' : '미처리'}</Row>
          <Row label="유입코드" mono>
            {member.inflow_code ?? '-'}
          </Row>
          <Row label="유입구분">{member.inflow_type ?? '-'}</Row>
          <Row label="담당자">{member.assigned_staff_id ? staffName[member.assigned_staff_id] ?? '-' : '미지정'}</Row>
          <Row label="팀">{member.team_id ? teamName[member.team_id] ?? '-' : '-'}</Row>
          <Row label="가입일시" mono>
            {datetime(member.registered_at)}
          </Row>
          <Row label="최근접속" mono>
            {member.last_active_at ? datetime(member.last_active_at) : '미접속'}
          </Row>
          <Row label="당첨이력">{member.win_history ?? '-'}</Row>
          <Row label="홈페이지 ID" mono>
            {homepageId(member.phone) || '-'}
          </Row>
          <Row label="홈페이지 PW(기본)" mono>
            {homepagePw(member.phone) || '-'}
          </Row>
        </dl>
      )}

      {tab === 'payments' && (
        <TabList
          rows={payments}
          empty="결제 내역이 없습니다."
          render={(p) => (
            <div key={p.id} className="flex items-center justify-between border-b border-gray-100 py-2.5">
              <div className="flex items-center gap-2">
                <StatusChip status={p.status} />
                <span className="text-[12.5px] font-semibold text-ink-800">
                  {p.product_id ? productName[p.product_id] ?? p.product_id : '-'}
                </span>
                <span className="text-[11.5px] text-gray-400">
                  {PAYMENT_METHOD_LABEL[p.method]}
                  {p.pg_provider ? ` · ${p.pg_provider}` : ''}
                </span>
              </div>
              <div className="text-right">
                <div className="font-mono text-[12.5px] font-bold tnum text-ink-800">{krw(p.amount)}</div>
                <div className="font-mono text-[10.5px] tnum text-gray-400">
                  {p.paid_at ? date(p.paid_at) : date(p.created_at)}
                </div>
              </div>
            </div>
          )}
        />
      )}

      {tab === 'sms' && (
        <div>
          {/* 문자 발송 */}
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent-100 bg-accent-50 p-2.5">
            <MessageSquare className="h-4 w-4 text-accent-600" />
            <select className={selectCls} value={smsTpl} onChange={(e) => setSmsTpl(e.target.value)}>
              {templates.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.title}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="acc"
              icon={<Send className="h-3.5 w-3.5" />}
              disabled={!smsTpl || sendSms.isPending}
              onClick={() => sendSms.mutate({ ids: [id], templateKey: smsTpl })}
            >
              발송
            </Button>
          </div>
          <TabList
            rows={sms}
            empty="발송된 문자가 없습니다."
            render={(s) => (
              <div key={s.id} className="border-b border-gray-100 py-2.5">
                <div className="flex items-center justify-between">
                  <StatusChip tone="info" label={SMS_TYPE_LABEL[s.type]} />
                  <span className="font-mono text-[10.5px] tnum text-gray-400">{datetime(s.sent_at)}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-gray-600">{s.body}</p>
              </div>
            )}
          />
        </div>
      )}

      {tab === 'assignments' && (
        <TabList
          rows={assignments}
          empty="배정 이력이 없습니다."
          render={(a) => (
            <div key={a.id} className="flex items-center justify-between border-b border-gray-100 py-2.5">
              <div className="flex items-center gap-2">
                <StatusChip
                  tone={a.type === 'auto' ? 'info' : 'success'}
                  label={a.type === 'auto' ? '자동' : '수동'}
                />
                <span className="text-[12.5px] font-semibold text-ink-800">
                  {a.staff_id ? staffName[a.staff_id] ?? a.staff_id : '미지정(리셋)'}
                </span>
                {a.assigned_by && (
                  <span className="text-[11px] text-gray-400">by {staffName[a.assigned_by] ?? a.assigned_by}</span>
                )}
              </div>
              <span className="font-mono text-[10.5px] tnum text-gray-400">{datetime(a.created_at)}</span>
            </div>
          )}
        />
      )}

      {tab === 'memo' && (
        <div>
          {/* 새 콜메모 추가 — 리스트형 누적(현장 피드백) */}
          <textarea
            value={memoDraft}
            onChange={(e) => setMemoDraft(e.target.value)}
            rows={3}
            placeholder="상담 메모를 입력하고 추가하세요. (기존 메모는 보존됩니다)"
            className="w-full rounded-md border border-gray-300 p-2.5 text-[13px] text-gray-700 outline-none focus:border-primary-500"
          />
          <div className="mt-2 flex justify-end">
            <Button
              size="sm"
              variant="pri"
              disabled={!memoDraft.trim() || addMemo.isPending}
              onClick={() =>
                addMemo.mutate(
                  { id, body: memoDraft },
                  { onSuccess: () => setMemoDraft('') },
                )
              }
            >
              메모 추가
            </Button>
          </div>

          {/* 누적 콜메모(최신순) */}
          {(() => {
            const memos = readMemos(member)
            if (memos.length === 0) {
              return (
                <div className="mt-4 py-8 text-center text-[12.5px] text-gray-400">
                  등록된 메모가 없습니다.
                </div>
              )
            }
            return (
              <ul className="mt-4 space-y-2">
                {memos
                  .slice()
                  .reverse()
                  .map((m) => (
                    <li key={m.id} className="rounded-md border border-gray-200 bg-white p-2.5">
                      <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-800">
                        {m.body}
                      </p>
                      <div className="mt-1 flex items-center gap-1.5 text-[10.5px] text-gray-400">
                        <span className="font-mono tnum">{datetime(m.created_at)}</span>
                        {m.author && <span>· {staffName[m.author] ?? m.author}</span>}
                      </div>
                    </li>
                  ))}
              </ul>
            )
          })()}

          {role === 'admin' &&
            (() => {
              const archived = (member.meta?.reset_memos as ResetMemo[] | undefined) ?? []
              if (archived.length === 0) return null
              return (
                <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
                  <div className="mb-1.5 text-[12px] font-bold text-gray-600">
                    초기화로 삭제된 콜메모 · {archived.length}건{' '}
                    <span className="font-normal text-gray-400">(최고관리자 전용)</span>
                  </div>
                  <ul className="space-y-1.5">
                    {archived
                      .slice()
                      .reverse()
                      .map((a, i) => (
                        <li key={i} className="flex flex-wrap gap-x-1.5 text-[12.5px]">
                          <span className="text-gray-800">{a.body}</span>
                          <span className="text-[11px] text-gray-400">· {datetime(a.archived_at)}</span>
                        </li>
                      ))}
                  </ul>
                </div>
              )
            })()}
        </div>
      )}

      {tab === 'reco' && (
        <div>
          <div className="mb-3 flex items-center gap-2 rounded-lg border border-accent-100 bg-accent-50 px-3 py-2 text-[11.5px] text-ink-700">
            <span>
              무료회원 주간 발급 번호입니다(매주 금 09:00, 문자 발송 없음). 회원은 홈페이지에서{' '}
              <b className="font-mono">{homepageId(member.phone)}</b> / 뒷4자리{' '}
              <b className="font-mono">{homepagePw(member.phone)}</b> 로 로그인해 확인합니다.
            </span>
          </div>
          {(() => {
            const issues = readWeeklyRecos(member.meta)
            if (issues.length === 0) {
              return (
                <div className="py-10 text-center text-[12.5px] text-gray-400">
                  발급된 번호가 없습니다.
                </div>
              )
            }
            return (
              <div className="space-y-4">
                {issues.map((iss) => (
                  <div key={`${iss.round_no}-${iss.issued_at}`} className="rounded-md border border-gray-200 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[12.5px] font-bold text-ink-800">
                        {iss.round_no}회 · {iss.sets.length}세트
                      </span>
                      <span className="font-mono text-[10.5px] tnum text-gray-400">{datetime(iss.issued_at)}</span>
                    </div>
                    <ul className="space-y-1.5">
                      {iss.sets.map((set, i) => (
                        <li key={i} className="flex items-center gap-2">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gray-100 text-[10px] font-bold text-gray-500 tnum">
                            {i + 1}
                          </span>
                          <LottoBalls numbers={set} size="sm" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      <ConfirmModal
        open={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        onConfirm={() =>
          updateMember.mutate(
            { id, patch: { status: 'suspended' } },
            { onSuccess: () => setConfirmSuspend(false) },
          )
        }
        title="회원 정지"
        description={`${member.name}(${member.user_id}) 회원을 정지 처리합니다.`}
        confirmText="정지"
        tone="danger"
        loading={updateMember.isPending}
      />
    </Drawer>
  )
}

function Row({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.3px] text-gray-400">{label}</dt>
      <dd className={mono ? 'font-mono text-[12.5px] text-ink-800' : 'text-[12.5px] text-ink-800'}>
        {children}
      </dd>
    </div>
  )
}

function TabList<T>({
  rows,
  render,
  empty,
}: {
  rows: T[]
  render: (row: T) => ReactNode
  empty: string
}) {
  if (rows.length === 0) {
    return <div className="py-10 text-center text-[12.5px] text-gray-400">{empty}</div>
  }
  return <div>{rows.map(render)}</div>
}
