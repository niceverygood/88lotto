// 문자 발송 도메인 로직 (CLAUDE §2 — feature 간 공유는 lib 경유).
// 템플릿 변수 치환 + 템플릿키→발송유형 매핑. 이용자/나의고객 모듈이 함께 사용.
import type { Member, SmsType } from '@/types/db'
import { BRAND } from '@/lib/brand'

// 템플릿 본문 변수: $name $id $pw $num $contents (CLAUDE §4 sms_templates)
// TODO(live-verify): $pw(임시비밀번호)·$num(회차 추천번호)은 실 연동 시 실제 값 주입.
export function renderSms(body: string, m: Member): string {
  const vars: Record<string, string> = {
    name: m.name,
    id: m.user_id,
    pw: '****',
    num: '— 회차 추천번호 —',
    contents: m.win_history ?? '',
  }
  return body.replace(/\$(name|id|pw|num|contents)/g, (_, k: string) => vars[k] ?? '')
}

/** 회차 표기. 점 없이 숫자 그대로(플러스로또 lib/sms.ts roundText 와 동일). */
export function roundText(roundNo: number): string {
  return String(Math.max(0, Math.trunc(roundNo)))
}

/**
 * 추천 조합 SMS 본문 — 회원정보창 조합발송·템플릿 '추천번호' 발송·수동발급이 모두 같은 포맷을 쓰도록
 * 통일(현장 피드백 6/22: "추천번호 발송 내용 = 회원정보창 번호 문자발송 내용 동일").
 *
 * 본문은 sms_templates 'recommend' 템플릿에서 온다(현장 8/28, 정의현 차장 — "88로또 조합발송
 * 형식을 플러스로또와 동일하게 바꾸려고 수정을 하는데 반영이 안됩니다"). 지금까지 88로또는 본문이
 * 코드에 박혀 있어 설정에서 무엇을 고쳐도 발송이 바뀌지 않았다. 플러스로또가 8/4 에 먼저 한 변경
 * (PlusLotto D148)을 그대로 옮긴 것이라 변수·조합 리스트 표기가 양쪽 동일하다.
 * 변수: $round(회차) · $name(회원명) · $num(조합 리스트).
 * api/weekly-reco.ts 자동발송 크론도 동일 규칙(src import 불가라 자급자족 중복 구현).
 */
export const RECO_TEMPLATE_FALLBACK = `[${BRAND.name}] $round회 추천번호\n$name님\n$num`

export function recoSmsBody(
  name: string,
  roundNo: number,
  sets: number[][],
  templateBody?: string | null,
): string {
  const lines = sets.map((s, i) => `[${i + 1}] ${s.join(',')}`).join('\n')
  const body = templateBody?.trim() ? templateBody : RECO_TEMPLATE_FALLBACK
  return body
    .replace(/\$round/g, roundText(roundNo))
    .replace(/\$name/g, name || '회원')
    .replace(/\$num/g, lines)
}

/** 템플릿 key → 발송유형(가입·추천·당첨·마케팅). 미지정 템플릿은 마케팅으로 분류. */
export function smsTypeForTemplate(key: string | null): SmsType {
  switch (key) {
    case 'join':
      return 'join'
    case 'win':
      return 'win'
    case 'recommend':
      return 'recommend'
    default:
      return 'marketing'
  }
}
