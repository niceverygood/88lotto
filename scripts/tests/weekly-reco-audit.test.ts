// 조합발송 누락 대조 — 허위(정상 제외를 누락으로 잡는 것)가 없는지 고정하는 테스트.
//
// 2026-09-16 이 전산에서 유료회원 1,986명 중 1,035명만 발송되고 951명이 조용히 누락됐다.
// 대조 기능은 그 재발을 잡기 위한 것인데, 목록에 허위가 섞이면 현장이 목록을 믿지 않게 되어
// 오히려 진짜 누락을 놓치게 된다. 그래서 검증의 중심을 "안 잡혀야 할 것이 안 잡히는가"에 둔다.
//
// 실행: node --import tsx --test scripts/tests/*.test.ts
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  expectsComboSms,
  kstDay,
  recoAuditMisses,
  recoSkipReason,
  type RecoAuditCtx,
  type RecoGateCtx,
} from '../../api/weekly-reco.ts'

const SINCE = '2026-09-15T00:00:00.000Z'
const ROUND = 1242

const ctx: RecoGateCtx = {
  today: 2, // 화요일 — 88로또 유료회원 지정 발송요일
  force: false,
  autoEnabled: true,
  paidSmsOn: true,
  targetRound: ROUND,
}

function auditCtx(over: Partial<RecoAuditCtx> = {}): RecoAuditCtx {
  return { ...ctx, sinceIso: SINCE, smsOk: new Set(), smsFail: new Set(), ...over }
}

type Row = Parameters<typeof recoAuditMisses>[0][number]

function row(id: string, over: Partial<Row> = {}): Row {
  return {
    id,
    grade: 'vip',
    name: `회원${id}`,
    phone: `0100000${id.padStart(4, '0')}`,
    meta: { weekly_reco_day: 2 },
    registered_at: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function issued(day = 2, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { weekly_reco_day: day, weekly_recos: [{ round_no: ROUND, issued_at: SINCE, sets: [] }], ...extra }
}

test('KST 날짜 환산 — 자정 전후', () => {
  assert.equal(kstDay(Date.parse('2026-09-15T14:59:59.000Z')), '2026-09-15')
  assert.equal(kstDay(Date.parse('2026-09-15T15:00:00.000Z')), '2026-09-16')
})

// ── 게이트 ───────────────────────────────────────────────────────────────────
test('발급 대상/제외 판정이 한 함수로 모인다', () => {
  assert.equal(recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 2 } }, ctx), null)
  assert.equal(recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 3 } }, ctx), 'day')
  assert.equal(recoSkipReason({ grade: 'vip', meta: null }, ctx), 'day') // 유료 요일 미설정
  assert.equal(recoSkipReason({ grade: 'free', meta: null }, { ...ctx, today: 5 }), null) // 무료 기본요일
  assert.equal(recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 2, reco_paused: true } }, ctx), 'paused')
  assert.equal(
    recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 2, weekly_reco_count: 0 } }, ctx),
    'count-zero',
  )
  assert.equal(recoSkipReason({ grade: 'vip', meta: issued() }, ctx), 'already')
})

test('일시정지는 force 로도 우회되지 않는다', () => {
  assert.equal(
    recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 9, reco_paused: true } }, { ...ctx, force: true }),
    'paused',
  )
})

test('이 전산에는 종료일(end_date) 게이트가 없으므로 대조도 그 규칙을 쓰지 않는다', () => {
  // 형제 프로젝트(PlusLotto)의 규칙을 그대로 옮기면, 실제로는 발송된 회원이 대조에서 제외돼
  // 진짜 누락이 가려진다. 발송 규칙이 다르면 대조 규칙도 달라야 한다.
  assert.equal(recoSkipReason({ grade: 'vip', meta: { weekly_reco_day: 2, end_date: '2020-01-01' } }, ctx), null)
  const r = recoAuditMisses([row('e', { meta: { weekly_reco_day: 2, end_date: '2020-01-01' } })], auditCtx())
  assert.deepEqual(
    r.misses.map((m) => m.reason),
    ['not_issued'],
  )
})

// ── 허위를 만들지 않는다(이 기능의 핵심) ────────────────────────────────────
test('정상 제외 사유 4종은 누락으로 잡히지 않는다', () => {
  const rows = [
    row('1', { registered_at: '2026-09-15T09:10:00.000Z' }), // 발송 시작 이후 가입
    row('2', { meta: { weekly_reco_day: 2, reco_paused: true } }), // 일시정지
    row('3', { meta: { weekly_reco_day: 2, weekly_reco_count: 0 } }), // 발송갯수 0
    row('4', { meta: { weekly_reco_day: 4 } }), // 그날 지정요일 아님
  ]
  const r = recoAuditMisses(rows, auditCtx())
  assert.deepEqual(r.misses, [])
  assert.equal(r.expected, 0)
  assert.equal(r.checked, 4)
  assert.deepEqual(r.excluded, { day: 1, paused: 1, count_zero: 1, registered_after: 1, no_phone: 0 })
})

test('발송 시작 이후 가입자는 발급 기록이 없어도 누락이 아니다', () => {
  const late = row('n', { registered_at: '2026-09-15T09:30:00.000Z' })
  assert.deepEqual(recoAuditMisses([late], auditCtx()).misses, [])
  const early = row('e', { registered_at: '2026-09-14T23:59:00.000Z' })
  assert.deepEqual(
    recoAuditMisses([early], auditCtx()).misses.map((m) => m.reason),
    ['not_issued'],
  )
})

// ── 진짜 누락 ────────────────────────────────────────────────────────────────
test('951명 사고 유형 — 발송이 중간에 끊긴 회원을 not_issued 로 잡는다', () => {
  // 앞쪽 1,035명은 발급·발송 완료, 뒤쪽은 함수가 끊겨 통째로 빠진 상황을 축약.
  const sent = ['a', 'b'].map((id) => row(id, { meta: issued() }))
  const missed = ['x', 'y', 'z'].map((id) => row(id))
  const r = recoAuditMisses([...sent, ...missed], auditCtx({ smsOk: new Set(['a', 'b']) }))
  assert.deepEqual(
    r.misses.map((m) => [m.member_id, m.reason]),
    [
      ['x', 'not_issued'],
      ['y', 'not_issued'],
      ['z', 'not_issued'],
    ],
  )
  assert.equal(r.expected, 5)
})

test('발급됐지만 문자 기록이 없으면 sms_missing, 실패 응답이면 sms_failed', () => {
  const rows = [row('ok', { meta: issued() }), row('gone', { meta: issued() }), row('failed', { meta: issued() })]
  const r = recoAuditMisses(rows, auditCtx({ smsOk: new Set(['ok']), smsFail: new Set(['failed']) }))
  assert.deepEqual(
    r.misses.map((m) => [m.member_id, m.reason]),
    [
      ['gone', 'sms_missing'],
      ['failed', 'sms_failed'],
    ],
  )
})

test('누락 목록에 이름·번호가 담겨 현장이 바로 연락할 수 있다', () => {
  const [miss] = recoAuditMisses([row('x', { name: '홍길동', phone: '01012345678' })], auditCtx()).misses
  assert.deepEqual(miss, {
    member_id: 'x',
    name: '홍길동',
    phone: '01012345678',
    grade: 'vip',
    reason: 'not_issued',
  })
})

// ── 문자 대상 판정 ───────────────────────────────────────────────────────────
test('무료회원은 발급만 받고 문자 미발송이 누락이 아니다', () => {
  const r = recoAuditMisses([row('f', { grade: 'free', meta: issued(5) })], auditCtx({ today: 5 }))
  assert.deepEqual(r.misses, [])
  assert.equal(r.expected, 1)
})

test('유료 SMS 가 꺼져 있으면 문자 미발송을 누락으로 보지 않는다', () => {
  assert.deepEqual(recoAuditMisses([row('p', { meta: issued() })], auditCtx({ paidSmsOn: false })).misses, [])
})

test('유료인데 번호가 없으면 누락이 아니라 회원정보 문제로 따로 센다', () => {
  const r = recoAuditMisses([row('np', { phone: null, meta: issued() })], auditCtx())
  assert.deepEqual(r.misses, [])
  assert.equal(r.excluded.no_phone, 1)
})

test('재발송으로 성공 기록이 생기면 앞선 실패는 누락이 아니다', () => {
  const r = recoAuditMisses([row('r', { meta: issued() })], auditCtx({ smsOk: new Set(['r']), smsFail: new Set(['r']) }))
  assert.deepEqual(r.misses, [])
})

test('expectsComboSms 는 유료 SMS 가동·유료등급·번호 세 조건을 모두 본다', () => {
  assert.equal(expectsComboSms({ grade: 'vip', phone: '01000000000' }, { paidSmsOn: true }), true)
  assert.equal(expectsComboSms({ grade: 'free', phone: '01000000000' }, { paidSmsOn: true }), false)
  assert.equal(expectsComboSms({ grade: 'vip', phone: null }, { paidSmsOn: true }), false)
  assert.equal(expectsComboSms({ grade: 'vip', phone: '01000000000' }, { paidSmsOn: false }), false)
})

// ── 구조 가드 ────────────────────────────────────────────────────────────────
test('발송 루프와 누락 대조가 판정 함수를 공유한다', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../../api/weekly-reco.ts', import.meta.url)), 'utf8')
  const count = (needle: string) => src.split(needle).length - 1

  // 각 판정 조건은 파일 전체에서 정확히 한 번(= recoSkipReason 본문)만 나와야 한다.
  for (const expr of [
    "if (meta.reco_paused === true) return 'paused'",
    'meta.weekly_reco_count === 0',
    'recos.some(issue => issue?.round_no === ctx.targetRound)',
    '? DEFAULT_DAY',
  ]) {
    assert.equal(count(expr), 1, `판정 조건이 여러 곳에 적혀 있다: ${expr}`)
  }
  assert.equal(count("recoSkipReason(options.mode === 'manual' ? { ...r, meta: manualMeta } : r, gateCtx)"), 1, '발송 루프가 공용 게이트를 써야 한다')
  assert.equal(count('recoSkipReason(r, ctx)'), 1, '대조가 공용 게이트를 써야 한다')
})

test('대조 실행(audit=1)은 발송을 하지 않고 또 다른 대조를 부르지 않는다', async () => {
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const src = readFileSync(fileURLToPath(new URL('../../api/weekly-reco.ts', import.meta.url)), 'utf8')

  const branch = src.indexOf('if (auditOnly) {')
  assert.ok(branch > 0, 'auditOnly 분기가 있어야 한다')
  const body = src.slice(branch, src.indexOf('\n    }\n', branch))
  for (const forbidden of ['sendComboSms', "from('members').update", 'audit=1', 'chain=']) {
    assert.ok(!body.includes(forbidden), `대조 분기가 ${forbidden} 를 해서는 안 된다`)
  }
  assert.ok(body.includes('return res.status(200).json('), '대조 분기는 자체 응답으로 끝나야 한다')
  assert.ok(branch < src.indexOf('const eligible:'), '대조 분기가 발송 루프보다 앞에 있어야 한다')
})
