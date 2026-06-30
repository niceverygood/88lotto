// ─────────────────────────────────────────────────────────────────────────
// 88로또 고객 홈페이지 — 88멤버십 (등급 안내) 페이지 (/portal/membership)
// ─────────────────────────────────────────────────────────────────────────
// 무료/골드/골드플러스/VIP/로얄 등급의 혜택을 비교하는 마케팅·안내 페이지.
// 등급 색은 전부 grade-* 토큰(임의 hex 금지). 가격은 "문의" placeholder.
// 로그인 시 본인 등급을 상단에 하이라이트하고, 비로그인 시 가입/문의 CTA 노출.
//
// ※ 이 파일은 <SiteLayout/> 의 <Outlet/> 안에 렌더되므로 "본문 콘텐츠"만 반환한다.
//   (SiteLayout 을 import 하지 않는다.) 라우트 등록은 Phase3 담당.
//
// TODO(live-verify): 등급별 실제 혜택(주간 조합수·문자·분석 범위)·가격은 운영 확정 후 교체.
// ─────────────────────────────────────────────────────────────────────────
import { Link } from 'react-router-dom'
import { Check, Crown, Headphones, Minus, Sparkles } from 'lucide-react'
import type { Grade } from '@/types/db'
import { GRADE_LABEL } from '@/design-system/labels'
import { Badge } from '@/design-system/components'
import { cn } from '@/lib/cn'
import { useMemberAuth } from './auth'

// ── 등급별 색 토큰 매핑 (Badge 와 동일한 grade-* 토큰만 사용) ───────────────
const GRADE_TONE: Record<
  Grade,
  { text: string; dot: string; ring: string; soft: string; bar: string }
> = {
  free: {
    text: 'text-grade-free',
    dot: 'bg-grade-free',
    ring: 'ring-grade-free/30',
    soft: 'bg-grade-free-bg',
    bar: 'bg-grade-free',
  },
  simple: {
    text: 'text-grade-simple',
    dot: 'bg-grade-simple',
    ring: 'ring-grade-simple/30',
    soft: 'bg-grade-simple-bg',
    bar: 'bg-grade-simple',
  },
  gold: {
    text: 'text-grade-gold',
    dot: 'bg-grade-gold',
    ring: 'ring-grade-gold/40',
    soft: 'bg-grade-gold-bg',
    bar: 'bg-grade-gold',
  },
  goldp: {
    text: 'text-grade-goldp',
    dot: 'bg-grade-goldp',
    ring: 'ring-grade-goldp/40',
    soft: 'bg-grade-goldp-bg',
    bar: 'bg-grade-goldp',
  },
  vip: {
    text: 'text-grade-vip',
    dot: 'bg-grade-vip',
    ring: 'ring-grade-vip/40',
    soft: 'bg-grade-vip-bg',
    bar: 'bg-grade-vip',
  },
  royal: {
    text: 'text-grade-royal',
    dot: 'bg-grade-royal',
    ring: 'ring-grade-royal/40',
    soft: 'bg-grade-royal-bg',
    bar: 'bg-grade-royal',
  },
  ovr: {
    text: 'text-grade-ovr',
    dot: 'bg-grade-ovr',
    ring: 'ring-grade-ovr/30',
    soft: 'bg-grade-ovr-bg',
    bar: 'bg-grade-ovr',
  },
  toss: {
    text: 'text-grade-toss',
    dot: 'bg-grade-toss',
    ring: 'ring-grade-toss/30',
    soft: 'bg-grade-toss-bg',
    bar: 'bg-grade-toss',
  },
}

// ── 페이지에 노출할 멤버십 등급(영업용) — simple/ovr/toss 는 내부 분류라 제외 ──
type TierGrade = 'free' | 'gold' | 'goldp' | 'vip' | 'royal'
const TIER_ORDER: TierGrade[] = ['free', 'gold', 'goldp', 'vip', 'royal']

interface TierPlan {
  grade: Grade
  /** 한 줄 소개 */
  tagline: string
  /** 주간 발급 추천 조합 수(영업 안내용 추정값) */
  weeklySets: string
  /** 카드에 노출할 핵심 혜택 요약 */
  highlights: string[]
  /** 추천(강조) 등급 여부 */
  featured?: boolean
}

// TODO(live-verify): 조합수/혜택 구성은 합리적 추정. 운영 확정 시 이 배열만 교체.
const TIER_PLANS: Record<Grade, TierPlan> = {
  free: {
    grade: 'free',
    tagline: '부담 없이 시작하는 무료 체험',
    weeklySets: '주 1조합',
    highlights: ['주간 추천 조합 1세트', '기본 회차 정보 열람', '마이페이지 발급내역 확인'],
  },
  gold: {
    grade: 'gold',
    tagline: '본격적인 번호 관리의 시작',
    weeklySets: '주 5조합',
    highlights: [
      '주간 추천 조합 5세트',
      '추천 번호 문자(SMS) 발송',
      '회차별 당첨 집계 알림',
      '기본 번호 분석 리포트',
    ],
  },
  goldp: {
    grade: 'goldp',
    tagline: '더 많은 조합과 우선 발송',
    weeklySets: '주 10조합',
    highlights: [
      '주간 추천 조합 10세트',
      '추천 번호 문자(SMS) 우선 발송',
      '회차별 당첨 집계 알림',
      '심화 번호 분석 리포트',
    ],
    featured: true,
  },
  vip: {
    grade: 'vip',
    tagline: '전담 관리와 프리미엄 분석',
    weeklySets: '주 20조합',
    highlights: [
      '주간 추천 조합 20세트',
      'VIP 전용 분석 리포트',
      '전담 상담원 1:1 관리',
      '당첨 패턴 맞춤 컨설팅',
    ],
  },
  royal: {
    grade: 'royal',
    tagline: '최상위 로얄 멤버 전용 혜택',
    weeklySets: '주 30조합+',
    highlights: [
      '주간 추천 조합 30세트 이상',
      '로얄 전용 프리미엄 분석',
      '최우선 전담 컨설팅',
      '특별 이벤트·당첨 케어',
    ],
  },
  // 비노출(내부 분류) — 타입 완결성용 더미 항목
  simple: { grade: 'simple', tagline: '간편가입', weeklySets: '-', highlights: [] },
  ovr: { grade: 'ovr', tagline: '-', weeklySets: '-', highlights: [] },
  toss: { grade: 'toss', tagline: '-', weeklySets: '-', highlights: [] },
}

// ── 등급 × 기능 비교 매트릭스 ──────────────────────────────────────────────
interface FeatureRow {
  label: string
  /** 노출 등급별 값: true/false 또는 텍스트 */
  values: Record<TierGrade, boolean | string>
}

// TODO(live-verify): 비교 항목/값은 합리적 추정. 운영 확정 시 교체.
const FEATURE_ROWS: FeatureRow[] = [
  {
    label: '주간 추천 조합 수',
    values: { free: '1조합', gold: '5조합', goldp: '10조합', vip: '20조합', royal: '30조합+' },
  },
  {
    label: '추천 번호 문자(SMS) 발송',
    values: { free: false, gold: true, goldp: true, vip: true, royal: true },
  },
  {
    label: '회차별 당첨 집계 알림',
    values: { free: false, gold: true, goldp: true, vip: true, royal: true },
  },
  {
    label: '번호 분석 리포트',
    values: { free: false, gold: '기본', goldp: '심화', vip: '프리미엄', royal: '프리미엄+' },
  },
  {
    label: '전담 상담원 1:1 관리',
    values: { free: false, gold: false, goldp: false, vip: true, royal: true },
  },
  {
    label: '맞춤 당첨 컨설팅',
    values: { free: false, gold: false, goldp: false, vip: true, royal: true },
  },
  {
    label: '특별 이벤트·당첨 케어',
    values: { free: false, gold: false, goldp: false, vip: false, royal: true },
  },
]

function CellValue({ value, tone }: { value: boolean | string; tone: string }) {
  if (value === true) {
    return (
      <span className={cn('inline-flex items-center justify-center', tone)}>
        <Check className="h-4 w-4" aria-label="제공" />
      </span>
    )
  }
  if (value === false) {
    return (
      <span className="inline-flex items-center justify-center text-gray-300">
        <Minus className="h-4 w-4" aria-label="미제공" />
      </span>
    )
  }
  return <span className="text-[12.5px] font-semibold text-ink-900 tabular-nums">{value}</span>
}

// ── 등급 카드 ──────────────────────────────────────────────────────────────
function TierCard({ plan, isCurrent }: { plan: TierPlan; isCurrent: boolean }) {
  const tone = GRADE_TONE[plan.grade]
  return (
    <div
      className={cn(
        'relative flex flex-col rounded-lg border bg-white p-5 shadow-sm transition',
        plan.featured ? 'border-primary-200 ring-1 ring-primary-100' : 'border-gray-200',
        isCurrent && 'ring-2 ring-primary-400',
      )}
    >
      {plan.featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary-600 px-3 py-1 text-[11px] font-bold text-white shadow-sm">
          인기
        </span>
      )}
      {isCurrent && (
        <span className="absolute right-4 top-4 rounded-full bg-primary-50 px-2 py-0.5 text-[10.5px] font-bold text-primary-700">
          내 등급
        </span>
      )}

      {/* 상단 색 바 */}
      <span className={cn('mb-4 h-1 w-10 rounded-full', tone.bar)} />

      <div className="mb-1 flex items-center gap-2">
        <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tone.dot)} />
        <h3 className={cn('text-[18px] font-extrabold', tone.text)}>{GRADE_LABEL[plan.grade]}</h3>
      </div>
      <p className="mb-4 text-[13px] leading-relaxed text-gray-500">{plan.tagline}</p>

      {/* 가격(문의 placeholder) */}
      <div className={cn('mb-4 rounded-md px-3 py-2.5', tone.soft)}>
        <div className="text-[11.5px] font-semibold text-gray-500">월 이용료</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[20px] font-extrabold text-ink-900">문의</span>
          <span className="text-[12px] font-medium text-gray-500">· {plan.weeklySets}</span>
        </div>
      </div>

      {/* 혜택 목록 */}
      <ul className="mb-5 flex flex-1 flex-col gap-2">
        {plan.highlights.map((h) => (
          <li key={h} className="flex items-start gap-2 text-[13px] leading-snug text-gray-700">
            <Check className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', tone.text)} />
            <span>{h}</span>
          </li>
        ))}
      </ul>

      {/* CTA */}
      <Link
        to="/portal/support"
        className={cn(
          'mt-auto inline-flex items-center justify-center gap-1.5 rounded-[7px] px-3.5 py-2.5 text-[13px] font-bold transition',
          plan.featured
            ? 'bg-primary-600 text-white hover:bg-primary-700'
            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-400',
        )}
      >
        {plan.grade === 'free' ? '무료로 시작하기' : '가입 문의하기'}
      </Link>
    </div>
  )
}

export function MembershipPage() {
  const { member } = useMemberAuth()
  const currentGrade = member?.grade ?? null

  return (
    <div className="font-sans">
      {/* ── 히어로 ───────────────────────────────────────────── */}
      <section className="border-b border-gray-200 bg-gradient-to-b from-ink-900 to-ink-800">
        <div className="mx-auto max-w-[1120px] px-4 py-14 sm:px-6 sm:py-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] font-semibold text-accent-500">
            <Crown className="h-3.5 w-3.5" />
            88멤버십
          </span>
          <h1 className="mt-4 text-[28px] font-extrabold leading-tight text-white sm:text-[34px]">
            등급별 맞춤 번호 서비스로
            <br className="hidden sm:block" /> 더 똑똑하게 시작하세요
          </h1>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-gray-300 sm:text-[15px]">
            무료부터 로얄까지, 원하는 만큼의 추천 조합과 전용 분석을 제공합니다.
            등급은 언제든 상향할 수 있어요.
          </p>

          {member ? (
            <div className="mt-6 inline-flex items-center gap-3 rounded-lg bg-white/10 px-4 py-3 backdrop-blur">
              <span className="text-[13px] text-gray-200">
                <span className="font-bold text-white">{member.name}</span>님의 현재 등급
              </span>
              <Badge grade={member.grade} />
            </div>
          ) : (
            <div className="mt-6 flex flex-wrap gap-2.5">
              <Link
                to="/portal/signup"
                className="inline-flex items-center justify-center gap-1.5 rounded-[7px] bg-accent-500 px-5 py-2.5 text-[14px] font-bold text-white transition hover:bg-accent-600"
              >
                <Sparkles className="h-4 w-4" />
                회원가입하고 시작
              </Link>
              <Link
                to="/portal/login"
                className="inline-flex items-center justify-center rounded-[7px] border border-white/30 px-5 py-2.5 text-[14px] font-bold text-white transition hover:bg-white/10"
              >
                로그인
              </Link>
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto max-w-[1120px] px-4 py-12 sm:px-6 sm:py-14">
        {/* ── 등급 카드 ──────────────────────────────────────── */}
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[22px] font-extrabold text-ink-900">멤버십 등급 안내</h2>
            <p className="mt-1 text-[13.5px] text-gray-500">
              가격은 상담을 통해 안내드립니다. 부담 없이 문의해 주세요.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {TIER_ORDER.map((g) => (
            <TierCard key={g} plan={TIER_PLANS[g]} isCurrent={currentGrade === g} />
          ))}
        </div>

        {/* ── 기능 비교표 ────────────────────────────────────── */}
        <div className="mt-14">
          <h2 className="text-[22px] font-extrabold text-ink-900">등급별 혜택 비교</h2>
          <p className="mt-1 text-[13.5px] text-gray-500">
            등급에 따라 제공되는 서비스 범위를 한눈에 비교하세요.
          </p>

          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-[12.5px] font-bold text-gray-600">혜택 항목</th>
                  {TIER_ORDER.map((g) => {
                    const tone = GRADE_TONE[g]
                    const isCurrent = currentGrade === g
                    return (
                      <th
                        key={g}
                        className={cn(
                          'px-3 py-3 text-center text-[13px] font-extrabold',
                          tone.text,
                          isCurrent && 'bg-primary-50',
                        )}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <span className={cn('h-2 w-2 rounded-full', tone.dot)} />
                          {GRADE_LABEL[g]}
                        </span>
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {FEATURE_ROWS.map((row, i) => (
                  <tr
                    key={row.label}
                    className={cn('border-b border-gray-100', i % 2 === 1 && 'bg-gray-50/40')}
                  >
                    <td className="px-4 py-3 text-[13px] font-semibold text-gray-700">
                      {row.label}
                    </td>
                    {TIER_ORDER.map((g) => {
                      const tone = GRADE_TONE[g]
                      const isCurrent = currentGrade === g
                      return (
                        <td
                          key={g}
                          className={cn('px-3 py-3 text-center', isCurrent && 'bg-primary-50/60')}
                        >
                          <CellValue value={row.values[g]} tone={tone.text} />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-3 text-[12px] leading-relaxed text-gray-400">
            * 제공 조합 수·혜택 구성은 운영 정책에 따라 변경될 수 있으며, 정확한 내용은 상담 시
            안내드립니다.
          </p>
        </div>

        {/* ── 하단 CTA ──────────────────────────────────────── */}
        <div className="mt-14 rounded-lg border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-600">
                <Headphones className="h-5 w-5" />
              </span>
              <div>
                <h3 className="text-[17px] font-extrabold text-ink-900">
                  어떤 등급이 맞을지 고민되시나요?
                </h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-gray-500">
                  상담원이 회원님께 꼭 맞는 등급과 혜택을 친절하게 안내해 드립니다.
                </p>
              </div>
            </div>
            <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row">
              <Link
                to="/portal/support"
                className="inline-flex items-center justify-center gap-1.5 rounded-[7px] bg-primary-600 px-5 py-2.5 text-[14px] font-bold text-white transition hover:bg-primary-700"
              >
                <Headphones className="h-4 w-4" />
                상담·가입 문의
              </Link>
              {!member && (
                <Link
                  to="/portal/signup"
                  className="inline-flex items-center justify-center gap-1.5 rounded-[7px] border border-gray-300 bg-white px-5 py-2.5 text-[14px] font-bold text-gray-700 transition hover:bg-gray-50 hover:border-gray-400"
                >
                  회원가입
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
