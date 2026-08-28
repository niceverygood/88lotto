-- 조합문자 본문 템플릿화 (현장 8/28, 정의현 차장 — "88로또 조합발송 형식을 플러스로또와 동일하게
-- 바꾸려고 수정을 하는데, 반영이 안됩니다")
--
-- 지금까지 88로또의 조합문자 본문은 코드 하드코딩이라(src/lib/sms.ts recoSmsBody · 크론
-- api/weekly-reco.ts formatComboSms) 설정 > 기본문자 템플릿에서 무엇을 고쳐도 발송이 바뀌지
-- 않았다. 이번 배포부터 모든 조합문자 경로(회원정보창 수동발급·추천 템플릿 일괄발송·유료회원
-- 자동발송 크론)가 이 행의 body 를 읽는다. 플러스로또가 8/4 에 먼저 한 변경(PlusLotto D148)의 이식.
--
-- 변수: $round(회차) · $name(회원명) · $num(조합 리스트 [1] n,n,…)
-- 가입환영(join)·약관(terms)은 이미 템플릿 본문으로 발송되고 있어 변경 없음.
--
-- 기본 문구는 코드 폴백(src/lib/sms.ts RECO_TEMPLATE_FALLBACK · api/weekly-reco.ts)과 **같은
-- 문구**로 맞춘다 — 세 곳이 다르면 어디서 나간 문자인지 추적이 안 된다.
-- 이미 행이 있으면 덮어쓰지 않는다(do nothing) — 현장이 먼저 저장해 둔 문구를 배포가 되돌리면
-- 안 되기 때문이다. 실제 문구는 현장에서 설정 화면으로 바꾼다(그게 이 변경의 목적이다).

insert into public.sms_templates (key, title, body, category)
values ('recommend', '추천번호 안내', E'[88로또] $round회 추천번호\n$name님\n$num', 'recommend')
on conflict (key) do nothing;
