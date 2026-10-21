"use client";
import type { PdpBugReportContext } from "../../lib/shared/pdp-bug-report";
export interface PdpBugReportWidgetProps { context: PdpBugReportContext }
// 배곧 내부 도구에서는 기존 요청에 따라 외부 문의 기능을 표시하지 않습니다.
export function PdpBugReportWidget(_props: PdpBugReportWidgetProps) {
  return null;
}
