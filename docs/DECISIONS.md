# DECISIONS — 설계 결정 기록

> 형식: 결정 · 이유 · 영향. 접근/구조가 바뀌면 여기에 추가한다.

## 2026-06-01 · Phase 0

### D1. 데이터 계층 — Supabase 스키마 호환 로컬 폴백
- **결정**: 실 Supabase 자격증명이 없어, `features/*/api.ts` 훅 뒤에 Supabase와 동일한 형태의 로컬 데이터 계층(seed + localStorage 영속)을 둔다. `.env`의 `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`가 있으면 실 Supabase, 없으면 로컬 mock으로 자동 전환(`VITE_DATA_SOURCE`로 강제 지정 가능).
- **이유**: 자격증명 없이도 §8 교차연동·CRUD를 end-to-end로 시연할 수 있어야 함(DoD). 컴포넌트는 데이터 출처를 모르고 훅이 경계.
- **영향**: "컴포넌트 직접 fetch 금지" 규칙과 정합. 실서버 전환은 env 한 줄 + `supabase gen types`. 타입은 `types/db.ts` 단일.

### D2. 색 토큰은 CSS 변수, Tailwind는 var() 매핑
- **결정**: 모든 색을 `design-system/tokens.css`의 CSS 변수로 단일 정의하고 `tailwind.config.ts`는 hex가 아닌 `var(--token)`을 가리킨다(CLAUDE §3.2의 hex 나열을 변수 참조로 대체).
- **이유**: §10 "등급색 변경이 전 화면 Badge에 반영(토큰 연동)" 충족 — 런타임에 토큰만 바꿔도 전체 반영. 단일 소스.
- **영향**: 토큰 색에는 tailwind opacity 수식어 미지원(필요 시 rgba 직접). 등급색 설정(Phase 10)은 tokens 변수 오버라이드로 동작.

### D3. 스펙 문서 위치
- **결정**: `pluslotto_admin_spec.html`을 `docs/`로 이동(CLAUDE.md/BUILD_PROMPTS 참조 경로와 일치).

### D4. 빌드 — `tsc --noEmit && vite build`
- **결정**: 프로젝트 레퍼런스(`tsc -b`)/composite 대신 `tsc --noEmit`로 타입체크 후 `vite build`.
- **이유**: 레퍼런스/composite 설정 오류 리스크 제거. strict는 유지(noUnusedLocals/Parameters 포함).

### D5. 사이드바 = 4그룹 NAV 상수, 접힘 상태 zustand persist
- **결정**: 13개 메뉴를 `AppShell.tsx`의 `NAV` 상수(운영/고객·세일즈/로또/시스템 4그룹)로 정의. 접힘(64px)/펼침(248px)은 `uiStore`에 persist. 카운트 뱃지는 `navCounts` 플레이스홀더(빈 값, Phase 9 실시간 집계로 대체 — 하드코딩 금지).
- **이유**: 스펙 App Shell 프리뷰와 일치 + 메뉴 추가/역할 게이팅(Phase 2)을 상수 한 곳에서 처리.
- **영향**: Phase 0 은 전 메뉴 노출 + `관` 핀만 표기. 역할별 숨김은 Phase 2 에서 `useRole`로 필터.

### D6. React Router v7 future flag 선반영
- **결정**: `BrowserRouter`에 `v7_startTransition`/`v7_relativeSplatPath` future flag 적용.
- **이유**: 콘솔 경고 제거 + v7 마이그레이션 대비.

## 2026-06-01 · Phase 1

### D7. DataTable = 데이터 주도 + 전역 밀도 + 정렬 모드 자동
- **결정**: `<DataTable>`은 `data: T[]` + `isLoading`만 받고 TanStack Query 결합은 각 모듈 `api.ts`가 담당(컴포넌트 직접 fetch 금지 규칙 유지). 밀도는 `uiStore.density` 전역 상태. 정렬은 `onSortingChange` 제공 시 서버(manual), 미제공 시 클라이언트(`getSortedRowModel`). 행 선택은 내부 state + `bulkActions(ctx)` 렌더프롭으로 `selectedIds/selectedRows/clear` 노출. 세로 스크롤 sticky 헤더는 `maxBodyHeight` 지정 시 활성.
- **이유**: 한 컴포넌트로 정렬·선택·밀도·컬럼토글·일괄작업·페이지네이션·로딩/빈 상태를 흡수(스펙 "화면의 80%"). 서버/클라 정렬을 prop 유무로 분기해 데모·모듈 모두 커버.
- **영향**: 모듈은 selectedIds를 받아 일괄 뮤테이션 → 관련 쿼리 무효화(§8)만 연결하면 됨.

### D8. 컴포넌트 배럴 export + 라벨 단일 소스
- **결정**: `design-system/components/index.ts` 배럴로 전 컴포넌트 export, feature는 배럴만 import(CLAUDE §2 "공유는 design-system/lib 경유"). 등급/상태/결제수단/문자유형 한글 라벨은 `design-system/labels.ts` 단일 정의.
- **영향**: StatusChip은 `status` 키 매핑 또는 `tone+label` 임의 사용 둘 다 지원(문의 상태 등 확장).

### D9. /dev/components 검수 라우트
- **결정**: Phase 1 검수용 데모 페이지를 `/dev/components`에 둠.
- **이유**: 모든 컴포넌트의 기본/로딩/빈/선택/접힘 상태를 한 화면에서 확인(BUILD_PROMPTS Phase 1 검수).
- **영향**: TODO(Phase 11): 프로덕션 빌드에서 dev 라우트 제외 검토.

## 2026-06-01 · Phase 2

### D10. mock 데이터 계층 — 버전드 localStorage 단일 저장소
- **결정**: `lib/db/store.ts`가 `DbShape`(11개 테이블) 전체를 `localStorage['pluslotto-db']`에 `{__v, data}`로 영속. `readDb()`/`mutateDb(fn)`/`resetDb()` 3개 API + `genId/nowIso`. 시드는 `lib/db/seed.ts`. `DB_VERSION` 불일치 시 자동 재시드.
- **이유**: D1의 "Supabase 동일 형태 로컬 폴백"을 단일 저장소로 구체화 — api 훅이 readDb로 읽고 mutateDb로 쓰며 §8 교차연동을 로컬에서 end-to-end 시연. 시드 구조 변경(Phase 3 회원/Phase 11 대량)은 DB_VERSION만 올리면 안전 재시드.
- **영향**: 컴포넌트 직접 접근 금지(여전히 api.ts 경유). 실 Supabase 전환 시 이 계층은 우회.

### D11. 세션 = zustand persist + mock 데모 로그인 / supabase 자동 분기
- **결정**: `lib/auth.ts`를 `useSessionStore`(persist `pluslotto-session`, currentUser)로 재작성. `signIn(identifier, password?)`은 `dataSource`에 따라 분기 — mock은 `staff.login_id` 매칭(비번 무시), supabase는 `signInWithPassword`. 로그인 성공 시(mock) `staff.last_login_at` 갱신 + `admin_log` 적재(§8). `useCurrentUser/useRole`은 `CurrentUser|null` 반환.
- **이유**: 자격증명 없이도 4역할 로그인 시연(DoD). 훅 시그니처가 nullable이 되어 RequireAuth/RequireRole가 미인증을 명시적으로 처리.
- **영향**: 라우트는 `/login`(셸 밖) + `RequireAuth`로 셸 보호. supabase 세션 복원(onAuthStateChange)은 TODO.

### D12. 메뉴 노출 = permissions 매트릭스, 데이터 접근 = RLS 초안
- **결정**: `lib/permissions.ts`의 `NAV_ACCESS: Record<NavKey, Role[]>` + `canAccess(role,key)`로 사이드바를 역할 필터. RLS는 `lib/rls/policies.sql` 초안(rep=assigned_staff_id, leader=team_id, manager·admin=전체)으로 두고 실 전환 시 적용. 매트릭스 추정은 ASSUMPTIONS 기록.
- **이유**: §5 "메뉴 노출은 useRole 가드 + 데이터는 RLS 이중 통제". mock 모드엔 RLS가 없으므로 메뉴 게이팅으로 역할 차이를 시연.
- **영향**: AppShell이 `canAccess`로 그룹/항목 필터(빈 그룹 숨김). 모듈 라우트에는 Phase 3+에서 `RequireRole` 부착.

## 2026-06-01 · Phase 4 (결제)

### D13. 교차모듈 쿼리 키 단일 출처 = `lib/queryKeys.ts`
- **결정**: `memberKeys`/`paymentKeys`를 `lib/queryKeys.ts`로 옮겨 공유. members/api·payments/api는 여기서 import 후 re-export. payments 뮤테이션이 members 캐시를 무효화해야 하는데(§8 결제승인→등급), feature 간 직접 import는 §2 금지이므로 lib 경유.
- **이유**: §8 "쿼리 키 공유/무효화" + §2 "feature 간 직접 import 금지, lib 경유"를 동시에 만족.
- **영향**: 새 모듈도 교차 무효화가 필요하면 키를 여기에 추가. `memberKeys`는 내부 사용만(외부 importer 없음 확인 후 이동).

### D14. 결제 승인/취소 = §8 부수효과 + 등급 롤백 휴리스틱
- **결정**: 승인 시 `applyApproval`(payment.status=approved, paid_at/period 설정, member.grade=product.grade_granted, status=active). 취소 시 status=cancelled + **등급 롤백 검토**: 이 결제가 부여한 등급이고 다른 승인 결제가 그 등급을 더는 받쳐주지 않으면 member.grade='free'. 매출은 별도 컬럼 없이 "승인 결제 합계"로 자동 산출(차감=취소 시 자연 반영). 각 뮤테이션은 payment_log 적재.
- **이유**: §8 표 "결제 승인/취소 → member 등급·상태·매출·로그 동시 반영". 등급 롤백은 원본 미확인이라 합리적 휴리스틱으로 구현(ASSUMPTIONS 기록).
- **영향**: 매출 모듈(Phase 5)은 payments(status='approved')만 집계하면 됨 — 별도 매출 테이블 불필요. 롤백 규칙은 라이브 확인 대상.

### D15. 결제 무효화는 detail 키까지 — `['payments']` ≠ `['payment',id]`
- **결정**: 승인/취소 onSuccess에서 `paymentKeys.all`(`['payments']`)뿐 아니라 `paymentKeys.detail(id)`(`['payment',id]`)도 무효화. 둘은 접두사가 달라(복수/단수) all 무효화가 detail을 커버하지 못함 → 열린 상세 Drawer가 즉시 갱신 안 되는 버그를 브라우저 검증 중 발견·수정.
- **영향**: 단/복수 키 분리 패턴을 쓰는 모듈은 동일 주의. detail 무효화 누락 시 Drawer stale.

### D16. 수기결제 폼 참조데이터 = payments/api 내 스토어 직접 조회
- **결정**: `/payments/manual`의 회원검색·활성상품 목록은 members/api(useProducts 등)를 import하지 않고 payments/api에 `useMemberSearch`(스코프 적용·20건 캡)·`useActiveProducts`를 두어 스토어를 직접 읽는다.
- **이유**: §2 feature 간 직접 import 금지. 상품/회원은 참조데이터지만 lib 이동 대신 feature-local 조회로 경계 유지(추후 다수 feature가 상품을 쓰면 lib/products로 승격 검토).
- **영향**: 약간의 조회 로직 중복. 폼은 react-hook-form + zod(프로젝트 첫 폼) — 이후 설정/편집 폼의 패턴 기준.

## 2026-06-01 · Phase 5 (매출)

### D17. 매출 = payments(approved) 파생, 3뷰는 단일 `/revenue` + `?view` 탭
- **결정**: 별도 매출 테이블 없이 `payments.status='approved'` 를 기간/스코프로 집계(D14 연장). BUILD_PROMPTS 의 `/revenue/real|conversion|team` 3경로는 **사이드바 IA 단일 '매출' 진입**과 정합하도록 한 페이지(`RevenuePage`)의 탭 `?view=real|conversion|team` 으로 실현(members `?view=` 패턴 D7/§7 과 동일). 실매출은 담당/팀/상품/PG 그룹 토글(`?group=`), 팀장매출은 팀 고정, 전환매출은 담당자(귀속) 고정.
- **이유**: §7 URL-동기화 saved-view 패턴 재사용 + 사이드바 active 상태 단순. 3뷰가 공통 골격(DateRangeFilter+KPI+차트+표)이라 단일 페이지가 DRY.
- **영향**: 라우트 1개. 뷰별 차이는 집계 차원/대상 집합만 분기.

### D18. 매출 귀속/인식 규칙은 `lib/revenueRules.ts` 상수로 분리
- **결정**: 매출 인식 시점(`recognitionDate='paid_at'`)·귀속 대상(`attribution='payment_staff'`)·전환 정의(`conversion='first_approved_paid'`)를 `REVENUE_RULES` 상수 + `recognitionIso(p)` 헬퍼로 한 곳에 둔다. 원본 정산 스펙 미확인이라 라이브 확인 후 한 줄 교체(ASSUMPTIONS 기록).
- **이유**: BUILD_PROMPTS Phase 5 "귀속 공식은 가정 → 상수화" + §9 "가정을 명시적 상수로".
- **영향**: 전환 정의/귀속 변경 시 집계 로직 수정 없이 상수만 교체.

### D19. 결제→매출 무효화(§8) + recharts 첫 도입 + 라우트 역할 가드 첫 적용
- **결정**: `revenueKeys`(`['revenue']`) 추가 → 결제 승인/취소/수기등록 onSuccess 에서 `revenueKeys.all` 무효화(§8 "결제 승인/취소 → 매출 반영/차감"). 차트는 recharts `AreaChart` 첫 사용 — 색은 토큰 `var(--primary-500)`/`var(--gray-*)` 로 지정(임의 hex 금지 유지). `/revenue` 에 `RequireRole(['admin','manager','leader'])` 부착(rep 차단) — 메뉴 노출(NAV_ACCESS)+라우트 가드 이중(§5), 프로젝트 첫 RequireRole 적용.
- **영향**: 결제와 매출이 동일 QueryClient 캐시에서 일관. 이후 모듈도 매출 영향 액션이면 revenueKeys 무효화. recharts 번들 증가(빌드 경고는 Phase 11 코드분할 대상). 다른 모듈 라우트 가드도 동일 패턴으로 부착.

## 2026-06-01 · Phase 6 (로또기록 · 베팅)

### D20. 채점 로직은 `lib/lotto.ts` 순수 함수 — seed(lib)와 feature 공유
- **결정**: 등수 산정(`gradeRank`)·당첨금(`prizeForRank`)·합/홀짝(`lottoSum`/`oddEven`)·일치수(`matchCount`)를 `lib/lotto.ts` 순수 함수로 단일 정의. 시드(`lib/db/seed.ts`)와 feature(`features/lotto/api.ts`, `features/bets/columns.tsx`)가 모두 여기서 import. 한국 로또 6/45 규칙: 6일치=1등, 5+보너스=2등, 5=3등, 4=4등, 3=5등, 그 외 미당첨.
- **이유**: 시드가 만든 당첨/베팅과 런타임 '당첨 확정'이 **동일 채점 결과**를 내야 함(검증 일관성). seed는 lib, feature는 features — 양쪽이 공유하려면 채점 로직이 lib 에 있어야 §2(feature 간 import 금지) 위반 없이 단일 소스 유지.
- **영향**: 등수/당첨금 규칙 변경은 `lib/lotto.ts` 한 곳. 4·5등 고정상금(5만/5천원)은 `FIXED_PRIZE` 상수.

### D21. `confirmed_at` 필드로 '당첨 확정' 멱등 워크플로
- **결정**: `LottoRound` 에 `confirmed_at: string|null` 추가(§4 원본 스키마엔 없음). null=미확정. `useConfirmRound` 가 해당 회차 전 베팅을 `gradeRank`/`prizeForRank` 로 채점하고 `confirmed_at=nowIso()` 설정. 베팅에서 등수 유무를 추론하지 않고 회차에 명시 상태를 둠.
- **이유**: 미확정→확정 전이를 한 플래그로 멱등하게(재확정 시 재산정) 표현. UI 탭(전체/미확정/확정)·상태 칩·'당첨 확정' 버튼 노출이 이 한 필드로 분기.
- **영향**: §8 "회차 등록/당첨 확정" 트리거 — 확정 시 `lottoKeys.all`+`betKeys.all`+`memberKeys.all` 무효화. 1~3등 당첨자(회원 연결분)는 `member.win_history=\`${회차}회 ${등수}등\`` 갱신 → 당첨자 세그먼트 자동 반영(브라우저 검증: 1180회 확정 시 전유진 win_history 갱신·당첨금 합계 KPI 일치 확인).

### D22. LottoBalls 컴포넌트 + 공 색 토큰(동행복권 공식 색대)
- **결정**: 당첨번호 시각화는 `design-system/components/LottoBalls.tsx` 단일 컴포넌트(원형 공, 보너스는 `+` 구분, `highlight` 로 일치 강조·비강조 dim). 공 색은 `tokens.css` 의 `--ball-y/b/r/k/g`(1–10 노랑·11–20 파랑·21–30 빨강·31–40 회색·41–45 초록) + tailwind `ball.*` 매핑. 임의 hex 금지 규칙 준수(토큰화).
- **이유**: 로또기록·베팅·회차등록 미리보기 3곳이 동일 시각화를 재사용(§6 컴포넌트 조립). 동행복권 공식 색대를 재현해 운영자 친숙도 확보.
- **영향**: 번호 일치 강조(`highlight`)로 베팅의 등수 근거를 시각적으로 즉시 확인.

### D23. 베팅은 전역 데이터(역할 스코프 없음) + 회차필터 `?round=` URL 동기화
- **결정**: 베팅(`features/bets`)은 회원 스코프(§5 RLS 에뮬)를 적용하지 않고 전역 조회. 로또기록 행 클릭 → `/bets?round=N` 으로 이동해 해당 회차 필터(검수 흐름). 회차 옵션은 `useBetRoundOptions` 가 `lib/db/store` 를 직접 읽어 lotto feature import 회피(§2).
- **이유**: 베팅/회차는 회원 담당과 무관한 운영 공통 데이터(발행처가 외부 지점·온라인 포함). 회차→베팅 드릴다운이 핵심 검수 동선.
- **영향**: 베팅 KPI(베팅수·당첨건수·당첨금합계)는 필터된 집합 기준 집계. rep 도 전체 베팅 열람 가능(라우트 가드 없음).

## 2026-06-02 · Phase 7 (나의고객 · 커뮤니티 · 고객센터)

### D24. 나의고객은 members feature 내부 페이지 · 공유는 lib 경유
- **결정**: 나의고객(`/my/customers`·`/my/sms`)을 별도 feature 가 아니라 `features/members/` 안의 `MyCustomersPage`·`MySmsPage` 로 둔다 — 동일 데이터 도메인이라 `MemberDrawer`·`columns`·`bulk`·뮤테이션을 §2 위반 없이 재사용. 나의고객 스코프는 RLS 역할 스코프와 별개인 **`assigned_staff_id === currentUser.id`(본인 케이스로드)** — manager/leader 도 여기선 본인 담당만 본다(`useMyCustomers`/`useMyCustomerCounts`/`useMySmsLog`). 문자 렌더(`renderSms`)·템플릿→유형 매핑(`smsTypeForTemplate`)은 members·나의고객 양쪽이 쓰므로 `lib/sms.ts` 로 추출. 고객센터의 공지 노출은 community feature 를 import 하지 않고 `lib/db/store` 의 `readDb().notices` 를 직접 읽고 `communityKeys.notices` 키를 공유(공지 뮤테이션 시 함께 무효화).
- **이유**: §2 "feature 간 직접 import 금지(공유는 design-system/lib 경유)" 와 코드 재사용을 동시에 만족. 나의고객은 이용자 모듈의 포커스 뷰일 뿐 새 도메인이 아님.
- **영향**: 라우트는 in-page write-gating(커뮤니티/FAQ 작성은 admin·manager) — `RequireRole` 미부착(문의 답변은 전 역할 가능). 향후 상품 등 다수 feature 공유 참조데이터가 늘면 lib 승격 검토(D16 연장).

### D25. mock 스토어 `mutateDb` = copy-on-write (§8 라이브 반영 보장)
- **결정**: `lib/db/store.ts` 의 `mutateDb` 를 in-place 변경에서 **copy-on-write**(현재 캐시를 깊은 복제 → fn 으로 변경 → `cache` 통째 교체 → persist)로 바꿨다. `readDb()` 는 여전히 캐시를 그대로 반환(읽기 무복제). feature 의 뮤테이션 코드는 그대로(여전히 `db` 인자를 in-place 로 변경).
- **이유**: 기존 in-place 변경은 React Query 가 들고 있는 직전 스냅샷의 **객체 참조를 오염**시켜, 무효화 후 재조회해도 structural sharing(`replaceEqualDeep`)이 "변경 없음"으로 판단 → 활성 옵저버가 리렌더되지 않았다(열린 목록/Drawer 가 stale, 리마운트해야 반영). 브라우저 검증 중 고객센터 문의 답변(대기→답변완료) 시 발견. copy-on-write 로 매 뮤테이션이 새 객체 그래프를 만들어 직전 스냅샷을 보존 → §8 "여러 모듈 동시 반영"이 리마운트 없이 즉시 동작.
- **영향**: 전 기능(이용자·결제·매출·로또·베팅·나의고객·커뮤니티·고객센터)의 §8 라이브 반영이 일괄 정상화. 검증: 문의 답변 시 대기/답변완료 카운트 즉시 변동, /my/sms 발송 시 발송내역 19→62 즉시 증가, 커뮤니티 공지 작성 시 목록 6→7 즉시 반영 + admin 로그 적재. 쓰기마다 전체 DB 깊은 복제 비용이 있으나 mock 한정(쓰기는 사용자 액션 빈도)·실 Supabase 전환 시 이 계층 우회라 무영향. 복제는 `structuredClone` 우선, 폴백 JSON.

## 2026-06-02 · Phase 8 (관리자 · 권한관리 · 로그)

### D26. 권한 매트릭스를 DB화(`nav_access`) — 사이드바+라우트가드 단일 출처
- **결정**: §5 메뉴 노출을 정적 `NAV_ACCESS` 상수가 아니라 **편집 가능한 DB 행 `nav_access: Record<NavKey, Role[]>`** 로 승격(`DbShape.nav_access`, 시드는 `DEFAULT_NAV_ACCESS` 복제). 읽기는 `lib/navAccess.ts` 의 `useNavAccess()`(TanStack Query, key `['nav-access']`), 판정은 `lib/permissions.ts` 의 `canAccessWith(map, role, key)`. AppShell(사이드바 그룹/항목 필터)과 새 `app/RequireNav.tsx`(라우트 가드)가 **동일 맵**을 사용 → 권한관리(`/admins/roles`)에서 모듈을 끄면 메뉴 숨김과 직접 URL 진입 차단이 한 번에 적용(§5 "메뉴+데이터 이중 통제"의 메뉴 절반을 런타임 편집화).
- **이유**: BUILD_PROMPTS Phase 8 "권한관리=역할×기능 체크박스 매트릭스" 를 시연하려면 매트릭스가 **저장되고 즉시 반영**돼야 함(§8). 정적 상수면 편집 불가.
- **영향**: 기존 `canAccess(role,key)`(정적)는 fallback 으로 유지하되 런타임 판정은 전부 `canAccessWith(navMap, …)` 경유. `nav_access` 누락 시 `DEFAULT_NAV_ACCESS` 로 안전 폴백(`readNavAccess`). DB_VERSION 4→5 로 올려 기존 localStorage 자동 재시드.

### D27. RequireNav 가 RequireRole 대체 — 매트릭스 기반 가드로 일원화(RequireRole 삭제)
- **결정**: 라우트 가드를 역할 하드코딩(`RequireRole(['admin','manager','leader'])`, D19)에서 **매트릭스 기반 `RequireNav navKey="…"`** 로 교체하고 `app/RequireRole.tsx` 를 삭제(데드코드). 허용 안 되면 항상 `/dashboard` 로 리다이렉트. `/dashboard` 자신은 가드하지 않음(리다이렉트 폴백 — 루프 방지). `/dev/components` 도 비가드(검수용).
- **이유**: 가드 기준이 두 곳(정적 배열 vs DB 맵)으로 갈리면 권한관리 저장이 라우트에 반영 안 되는 불일치 발생. 단일 출처(`nav_access`)로 통일.
- **영향**: 매출 가드도 `RequireNav navKey="revenue"` 로 전환(rep 차단은 기본 맵이 유지). 모든 모듈 라우트가 매트릭스에 종속 → 권한관리 한 화면이 메뉴+진입을 동시 통제.

### D28. 자기잠금(self-lockout) 3중 방어
- **결정**: 관리자가 자신의 권한/계정을 잠그지 못하도록 (1) 권한 매트릭스에서 `ADMIN_LOCKED=['admins','logs']` × `admin` 셀은 **항상 체크+disabled**(`isLockedCell`), (2) `canAccessWith` 가 ADMIN_LOCKED 키는 저장값과 무관히 **admin 에게 항상 허용**, (3) AdminsPage 에서 **현재 로그인 계정 자신의 비활성화 토글 disabled**. 비활성화는 `ConfirmModal tone="danger"` 필수(§10 위험 액션).
- **이유**: 권한관리/로그는 운영 복구 경로 — admin 이 실수로 끄면 자기 자신이 관리 화면에 못 들어가 잠김. 데이터·UI·판정 3계층에서 차단.
- **영향**: 매트릭스 저장값이 손상돼도 admin 의 admins/logs 접근은 보장. rep/leader/manager 의 admins/logs 는 정상적으로 토글 가능(잠금은 admin 행에 한정).

### D29. 감사 로그 5종 = 단일 `logs` 테이블 + kind 필터, 항상 최신 조회
- **결정**: 로그를 종류별 테이블(admin/payment/sms/inflow/point) 대신 **단일 `logs: LogEntry[]`**(공통 `kind, actor, action, target_type, target_id, meta, created_at`)로 두고 `/logs/:kind` 가 kind 필터+최신순. §8 액션들이 각자 `kind` 로 1행씩 적재(`features/admins/api.ts` 의 `adminLog`, auth 로그인, 결제/문자/유입 뮤테이션). `useLogs` 는 **staleTime:0 + refetchOnMount:'always'** 로 진입 시 항상 최신 — 다른 feature 가 `logKeys` 를 별도 무효화하지 않아도(§2 교차 무효화 회피) 적재분이 보임.
- **이유**: 5종이 동일 스키마라 단일 테이블이 DRY. 로그는 append-only 감사 화면이라 "항상 최신 재조회"가 무효화 그물망보다 단순·안전.
- **영향**: 액션 코드→한글 라벨은 `LogsPage.ACTION_LABEL` 한 곳(미정의 코드는 원문 노출). `actor=null` 은 '시스템'(자동 적립 등). 시드는 `genLogs` 가 실제 staff/member/payment/sms 참조로 admin19·payment·sms12·inflow8·point10 생성(브라우저 검증: 5탭 렌더 + 검색·기간 필터 동작).

### D30. ROLE_LABEL 을 lib/permissions 로 이동 + auth 액션코드 표준화
- **결정**: 역할 한글 라벨 `ROLE_LABEL`(관리자/실장/팀장/담당자)을 AppShell 로컬 상수에서 `lib/permissions.ts` 로 끌어올려 단일 정의(admins·logs·shell 공유). 로그인 감사 로그 액션코드를 `'login'` → `'auth.login'` 로 통일(로그 화면 `ACTION_LABEL` 키 체계 `domain.verb` 와 정합).
- **이유**: 라벨/코드가 화면마다 흩어지면 표기 불일치. §2 공유는 lib 경유.
- **영향**: 관리자·로그·셸이 동일 라벨. 기존 적재된 `'login'` 로그가 있다면 라벨 폴백(원문)으로 표시되나 재시드로 정리됨.

## 2026-06-02 · Phase 9 (통계 · 운영 대시보드)

### D31. 대시보드 = 보는 사람 스코프 실시간 집계, KPI 딥링크는 nav_access 로 게이팅
- **결정**: `/dashboard` 4개 KPI(오늘 신규유입·미아웃콜·결제대기·오늘매출)·14일 추이·처리대기 목록을 `readDb()` 에서 매번 파생(하드코딩 금지, §8). 수치는 보는 사람의 데이터 스코프(admin/manager=전체, leader=팀, rep=본인 담당)로 한정. KPI 카드/“전체보기” 딥링크는 `canAccessWith(navMap, role, navKey)` 가 true 일 때만 클릭 가능 — 아니면 숫자만 표시(라우트 가드 RequireNav 로 튕기는 것 방지).
- **이유**: 대시보드는 전 역할의 랜딩(가드 없음)이므로 rep 도 본인 책임 범위 수치를 봐야 유용. 그러나 매출/통계 등 rep 비접근 화면으로의 딥링크는 가드에 막혀 UX 가 깨지므로 클릭 자체를 비활성화.
- **영향**: 같은 화면이 역할마다 다른 수치를 보이되 일관. 딥링크 타깃: 신규유입→`/members?view=today-join`, 미아웃콜→`/members?view=no-outcall-all`, 결제대기→`/payments?st=wait`, 오늘매출→`/revenue`. 결제대기 카드는 PaymentsPage 의 `st` URL 파라미터를 그대로 사용(딥링크-필터 정합).

### D32. 통계 = 단일 `/stats` + `?view` 3뷰, 항상 최신 조회(D29), 결제뷰는 매출과 동일 파생
- **결정**: 가입·결제·유입 3통계를 별도 화면이 아니라 `/stats` 1개 + `?view=` 탭(매출 모듈 §7 패턴 재사용)으로 구현. `useStats(view,from,to)` 단일 훅이 view 로 분기해 통일된 `StatsResult{kpis,trend,breakdowns}` 반환. 집계 화면이므로 `staleTime:0 + refetchOnMount:'always'`(D29) — §8 액션 결과를 진입 시 즉시 반영.
- **이유**: 3뷰 골격(기간필터+KPI4+추이차트+분해표)이 동일 → 단일 페이지가 DRY. URL 동기화로 뒤로가기/공유 가능.
- **영향**: 결제뷰 매출 추이는 매출 모듈과 같은 `payments(status='approved')` 파생이라 수치 정합(§8). 단, 통계 결제뷰는 rep 도 본인 담당분을 보지만 매출 모듈은 rep 비접근(`scopeApproved` 가 rep→[]) — 스코프 규칙이 모듈별로 다름은 D31 의도(ASSUMPTIONS 기록).

### D33. 사이드바 뱃지 = 기존 무효화 프리픽스에 얹은 파생 쿼리
- **결정**: `lib/navBadges.ts` 의 `useNavBadges()` 가 결제대기(역할 스코프)·미답변 문의(공유 큐) 건수를 `paymentKeys.counts('nav:…')`·`supportKeys.inquiries({nav:…})` 키로 노출. 사이드바는 상주(remount 없음)라 refetchOnMount 가 안 먹으므로, 기존 §8 무효화(`['payments']`/`['support']` prefix invalidate)에 얹혀 결제 승인·문의 답변 시 자동 갱신되도록 같은 프리픽스 아래 다른 scope 로 키를 둠. 0/로딩은 생략, `admins`·`logs` 는 뱃지 대신 ‘관’ 칩 유지(count 미주입).
- **이유**: 뱃지를 위해 feature 훅을 import 하면 §2 위반 → lib 에서 `readDb()` 직접 파생. 별도 무효화 배선 없이 기존 액션이 뱃지를 살아있게 함.
- **영향**: 결제 승인 시 사이드바 ‘결제’ 뱃지·대시보드 결제대기 KPI 가 동시 감소(§8). scope 문자열에 uid/role 포함 → 역할 전환 시 캐시 분리.

## 2026-06-02 · Phase 10 (설정)

### D34. 설정 = 단일 `site_settings` 행 전체 교체 + 서브페이지 슬라이스 머지
- **결정**: 무통장·등급색·PG·문자·당첨문자·리포트·로또고정제외·약관을 별도 테이블이 아닌 **단일 `site_settings` 객체**(8 슬라이스)로 두고, 저장은 `useSaveSiteSettings(next)` 가 행 전체를 교체. 4개 화면(사이트설정 1 + 서브 3)은 각자 공유 캐시(`useSiteSettings`)에서 전체 settings 를 읽어 `{ ...settings, <슬라이스> }` 만 바꿔 제출 → 다른 슬라이스 보존. `SiteSettingsPage.toSettings(v, prev)` 도 미편집 슬라이스(report·lotto_exclude·terms)를 `prev` 에서 그대로 전달.
- **이유**: §4 "site_settings 단일 행" 추정 + 설정은 저빈도 편집이라 행 전체 교체가 슬라이스별 머지 로직보다 단순·안전. 캐시가 무효화로 항상 동기화되므로 머지 충돌 없음.
- **영향**: 브라우저 검증으로 교차 슬라이스 보존 확인(등급색 #ff0000 저장 후 리포트·로또·약관을 따로 저장해도 색 유지). 새 설정 항목 추가는 `SiteSettings` 타입 + seed `buildSiteSettings` 한 곳만 확장. DB_VERSION 5→6(시드에 site_settings 추가).

### D35. 등급색 런타임 토큰 오버라이드 — DB 값 → CSS 변수 주입으로 전 화면 Badge 즉시 반영
- **결정**: `grade_colors`(8등급 fg/bg)를 `lib/gradeTheme.ts` 가 `document.documentElement.style` 에 `--g-{grade}`/`--g-{grade}-bg` CSS 변수로 주입. `useGradeColorSync()`(providers 에 `<GradeThemeSync/>` 상주, key `settingsKeys.site()`)가 마운트·무효화 시 재적용. Badge/StatusChip 은 `bg-grade-*-bg text-grade-*`(=`var(--g-*)`) 클래스를 쓰므로 별도 구독 없이 색이 바뀜. 저장 → `settingsKeys.all` 무효화 → 재적용 → 전 화면 반영.
- **이유**: §3 "등급색은 토큰 한 곳에서만 정의, 운영진 익숙도 따라 추후 변경 가능". 토큰을 런타임 편집 가능하게 하려면 정적 CSS 가 아닌 변수 오버라이드가 필요. 등급 enum 값이 곧 변수 접미사(1:1)라 매핑 테이블 불요.
- **영향**: seed 기본색 = `tokens.css` 와 동일 hex → 편집 전 시각 변화 없음. 검증: 골드 fg `#ff0000` 저장 시 /members 의 골드 Badge 16개가 즉시 빨강, 새로고침 후에도 유지(상주 sync 가 재적용). 색은 사용자 데이터라 인라인 `style`(토큰 금지 예외 — DECISIONS 기존 합의).

### D36. 시크릿 = 마스킹 표시 + 회전 입력(SecretField), PG 키 매칭은 폼 값의 실제 id 로
- **결정**: API키/SMTNT키는 `SecretField` 가 저장값의 끝 4자리만 마스킹(`••••••••3f5a`) 표시, "변경" 클릭 시에만 빈 입력 노출, 빈 값으로 저장하면 기존 키 유지(`apiKeyNew.trim() || prev.api_key`). 실제 시크릿을 가시 필드로 왕복시키지 않음. PG 행의 저장키 조회는 `useFieldArray` 의 `field.id`(RHF 가 부여해 비즈니스 id 를 가림) 대신 **`getValues(\`pg.${i}.id\`)`(폼 값의 실제 id)** 로 매칭.
- **이유**: §10 "시크릿 마스킹 + 라이브 확인 TODO", 시크릿 비노출. `field.id` 직접 매칭은 useFieldArray 의 키 shadowing 때문에 항상 불일치 → 모든 PG 키가 '미설정' 으로 보이는 버그(브라우저 검증서 발견·수정).
- **영향**: 시드 키는 전부 가짜 데모값(`*_live_*`) — 실 시크릿 아님. 라이브 전환 시 실제 키 입력으로 교체. 6개 PG + SMTNT 모두 끝4자리 마스킹 확인, 원문 키 DOM 비노출 확인.

### D37. 프로덕션 번들 = 벤더 manualChunks 분할 (Phase 11 마감)
- **결정**: `vite.config.ts` `build.rollupOptions.output.manualChunks` 로 react/query/charts/supabase 4개 벤더 청크 분리. 단일 1.25MB 청크 → 최대 청크 < 500KB(앱 394KB·charts 383KB·supabase 211KB·react 157KB·query 101KB).
- **이유**: Vite 의 500KB 청크 경고 해소 + 벤더 캐시 분리(앱 코드만 바뀌면 무거운 recharts/supabase 청크는 재다운로드 안 함). 빌드 설정만 변경 — 앱 코드·런타임 무영향(라우트 lazy/Suspense 도입 안 함, 마감 시점 회귀 위험 회피).
- **영향**: `npm run build` 경고 없이 통과. 추가 최적화(라우트 코드 스플리팅)는 필요 시 후속.
