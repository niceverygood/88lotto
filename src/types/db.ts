// 88로또 도메인 타입 — 라이브 Supabase 확정 전 수기 작성한 인터림 모델.
// TODO(live-verify): 실 DB 연결 시 `supabase gen types typescript` 결과로 대체/정합. (DECISIONS D1)

export type Role = 'admin' | 'manager' | 'leader' | 'rep'

export type Grade =
  | 'simple' // 간편가입
  | 'free' // 무료
  | 'gold' // 골드
  | 'goldp' // 골드플러스
  | 'vip' // VIP
  | 'royal' // 로얄
  | 'ovr' // 인반언스 (명칭 미확인)
  | 'toss' // 토스DB

export type MemberStatus = 'active' | 'suspended' | 'deleted' | 'withdrawn'

export type PaymentStatus = 'wait' | 'approved' | 'failed' | 'cancelled'

export type PaymentMethod = 'bank' | 'manual' | 'pg' // 무통장 | 수기 | PG

export type SmsType = 'join' | 'recommend' | 'win' | 'marketing' | 'direct' // 가입·추천·당첨·마케팅·직접입력

export type AssignType = 'manual' | 'auto'

export type LogKind = 'admin' | 'point' | 'sms' | 'payment' | 'inflow'

export interface Team {
  id: string
  name: string
  leader_id: string | null
}

export interface Staff {
  id: string
  login_id: string
  name: string
  role: Role
  team_id: string | null
  is_active: boolean
  auto_assign_enabled: boolean // 자동배분 대상 풀 포함 여부(rep 대상, §V2-1)
  last_login_at: string | null
}

export interface Product {
  id: string
  name: string
  price: number
  duration_months: number
  grade_granted: Grade
  is_active: boolean
}

export interface Member {
  id: string
  user_id: string // 로그인 ID
  name: string
  nickname: string | null
  phone: string
  grade: Grade
  status: MemberStatus
  tendency: string | null // 성향
  consult_status: string | null // 상담상태(신규/결번/부재/가망/승인/통화예약/도입거절/일반거절/기타)
  inflow_code: string | null
  inflow_type: string | null
  assigned_staff_id: string | null
  team_id: string | null
  memo: string | null
  win_history: string | null
  outcall_done: boolean // 아웃콜 처리 여부
  registered_at: string
  last_active_at: string | null
  is_suspended: boolean
  is_deleted: boolean
  is_withdrawn: boolean
  meta: Record<string, unknown>
}

export interface Payment {
  id: string
  member_id: string
  product_id: string | null
  amount: number
  method: PaymentMethod
  pg_provider: string | null
  status: PaymentStatus
  period_start: string | null
  period_end: string | null
  depositor_name: string | null
  staff_id: string | null
  paid_at: string | null
  created_at: string
}

export interface SmsSend {
  id: string
  member_id: string
  template_key: string | null
  phone: string
  body: string
  type: SmsType
  status: string
  sent_at: string | null
}

export interface SmsTemplate {
  key: string
  title: string
  body: string
  category: string
}

export interface LottoRound {
  round_no: number
  draw_date: string
  numbers: number[] // 6개
  bonus: number
  sum: number
  odd_even: string
  appear_rate: number | null
  prize_1: number | null
  prize_2: number | null
  prize_3: number | null
  total_sales: number | null
  confirmed_at: string | null // 당첨 확정(베팅 등수/당첨금 산정) 시각. null=미확정
}

export interface Bet {
  id: string
  round_no: number
  issuer: string | null
  member_ref: string | null
  numbers: number[]
  rank: number | null
  prize: number | null
}

export interface Assignment {
  id: string
  member_id: string
  staff_id: string | null
  assigned_by: string | null
  type: AssignType
  created_at: string
}

export interface LogEntry {
  id: string
  kind: LogKind
  actor: string | null
  action: string
  target_type: string | null
  target_id: string | null
  meta: Record<string, unknown>
  created_at: string
}

// ── 커뮤니티 (공지사항 · 이벤트) ──────────────────────────────────────
export interface Notice {
  id: string
  title: string
  body: string
  pinned: boolean // 상단 고정
  published: boolean // 게시 여부(false=임시저장)
  author_id: string | null // staff.id
  view_count: number
  created_at: string
  updated_at: string
}

export interface CampaignEvent {
  id: string
  title: string
  body: string
  starts_at: string | null
  ends_at: string | null
  published: boolean
  author_id: string | null
  view_count: number
  created_at: string
  updated_at: string
}

// ── 고객센터 (1:1 문의 · FAQ) ─────────────────────────────────────────
export type InquiryStatus = 'open' | 'answered' // 대기 → 답변완료

export interface Inquiry {
  id: string
  member_id: string | null // 회원 연결(있으면)
  author_name: string
  category: string // 문의 유형(결제/번호/계정/기타)
  title: string
  body: string
  status: InquiryStatus
  answer: string | null
  answered_by: string | null // staff.id
  answered_at: string | null
  created_at: string
}

export interface Faq {
  id: string
  category: string
  question: string
  answer: string
  sort_order: number
  published: boolean
}

// ── 설정 (site_settings — 단일 행, Phase 10) ──────────────────────────
export interface BankTransferSettings {
  bank_name: string
  account_no: string
  holder: string
  guide: string // 입금 안내 문구
}

// PG 다중 설정(웰컴페이먼츠·페이허브·플러스페이·코밴·온미르·하이브플러스 등).
// api_key 는 시크릿 → UI 마스킹. TODO(live-verify): 실 PG 연동 키/TID 체계는 라이브 확정.
export interface PgProvider {
  id: string
  name: string
  enabled: boolean
  mid: string // 상점 ID
  api_key: string // 시크릿(마스킹)
  tids: string[] // 단말기 ID 다수(온미르 등)
  memo: string | null
}

export interface SmsSettings {
  sender_no: string // 발신번호(OneShot send_phone/CALLBACK — 사전등록 필수)
  smtnt_id: string // OneShot 사용자 아이디(매뉴얼 id, 예: lotto_dream_api)
  smtnt_key: string // (미사용) OneShot 은 IP 화이트리스트 인증이라 API 키 없음 — 보존용
  oneshot_enabled: boolean // 실발송 사용(OneShot 경유) §V2-6
  ad_optout: string // 광고성 무료수신거부 번호(있으면 마케팅 문자에 (광고)+번호 자동표기)
}

export interface GradeColor {
  fg: string // 라벨/도트 색
  bg: string // 칩 배경색
}
export type GradeColorMap = Record<Grade, GradeColor>

export interface WinMessage {
  rank: number // 1..5등
  body: string // $변수 사용 가능
}

// 정기 리포트(운영 지표 자동 발송) 설정. TODO(live-verify): 실제 발송 채널/지표 항목 라이브 확정.
export type ReportFrequency = 'daily' | 'weekly' | 'monthly'
export interface ReportSettings {
  enabled: boolean
  frequency: ReportFrequency
  weekday: number // 0=일 … 6=토 (frequency=weekly)
  day_of_month: number // 1..28 (frequency=monthly)
  time: string // HH:mm
  recipients: string[] // 수신 이메일
  sections: string[] // 포함 지표 키(revenue/signup/payment/outcall)
}

// 로또 추천 번호 고정/제외 설정(1..45). TODO(live-verify): 추천 엔진 연동 규칙 미확인.
export interface LottoExcludeSettings {
  fixed: number[] // 항상 포함
  excluded: number[] // 항상 제외
}

// 회차별 고정/제외 이력 + 효력일자(§V2-5). 토요일 입력 → 익주 월요일(effective_from)부터 적용.
// grade=null → 공통(전체 등급). 특정 등급 규칙이 있으면 그 등급은 등급 규칙, 없으면 공통으로 폴백(현장 피드백).
export interface LottoExcludeRule {
  id: string
  round_no: number
  grade: Grade | null // null = 공통(전체 등급 공통)
  fixed: number[]
  excluded: number[]
  effective_from: string // YYYY-MM-DD, 이 날짜부터 적용
  created_at: string
  created_by: string | null
}

// 무료회원 주간 자동발급(현장 피드백) — 매주 금 09:00 N조합 발급(문자발송 X), 홈페이지에서 조회.
export interface WeeklyFreeRecoSettings {
  enabled: boolean
  set_count: number // 발급 조합 수(기본 30) — 회원별 weekly_reco_count 가 우선
  logic_ratio?: number // 로직 적용 비율 %(기본 100) — 나머지는 완전랜덤 조합(현장 피드백)
  paid_sms?: boolean // 유료회원(골드/골드+/VIP/로얄) 지정요일 조합 SMS 자동발송(현장 피드백 6/18). 실발송(oneshot)+발신번호도 필요.
}

// 회원에게 발급된 주간 추천 1회분(member.meta.weekly_recos[]). 홈페이지(전화/뒷4자리)에서 조회.
export interface WeeklyRecoIssue {
  round_no: number
  issued_at: string
  sets: number[][] // 각 6/45 오름차순
}

export interface SiteSettings {
  bank: BankTransferSettings
  grade_colors: GradeColorMap
  pg_providers: PgProvider[]
  sms: SmsSettings
  win_messages: WinMessage[] // 1~5등 당첨문자
  report: ReportSettings
  lotto_exclude: LottoExcludeSettings // 현재 적용 스냅샷(폴백)
  lotto_exclude_history: LottoExcludeRule[] // 회차별 이력 + 효력일자(§V2-5)
  weekly_free_reco: WeeklyFreeRecoSettings // 무료회원 주간 자동발급(현장 피드백)
  terms: string // 이용약관 본문(공통/기본)
  terms_by_grade?: Partial<Record<Grade, string>> // 등급별 약관(현장 피드백 6/11) — 미설정 등급은 공통 폴백
}
