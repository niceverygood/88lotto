// 문자 발송 도메인 로직 (CLAUDE §2 — feature 간 공유는 lib 경유).
// 템플릿 변수 치환 + 템플릿키→발송유형 매핑. 이용자/나의고객 모듈이 함께 사용.
import type { Member, SmsType } from '@/types/db'

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
