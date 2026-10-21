# 인트라넷 Higgsfield 연결 수정

새 창에서는 연결됨과 크레딧이 표시되지만, `baegotint.com` 안의 iframe에서는 SameSite=Lax 쿠키가 전송되지 않아 미연결로 표시됐다.

- 기존 연결 확인은 팝업에서 확인한 세션을 60초 유효한 암호화 티켓으로 전달한다. 요청한 창만 가진 SHA-256 검증 값과 메시지의 origin·source를 확인한다.
- 공급자의 토큰은 서버에서만 복호화하며, iframe에는 Secure·HttpOnly·Partitioned 쿠키를 설정한다. 브라우저의 전역 쿠키 설정이나 기존 작업 저장소는 변경하지 않는다.
- 신규 OAuth 연결도 같은 전달 절차를 사용한다. 취소·실패·팝업 차단을 화면에 표시한다.
- 연결 정보가 없는 조회는 다른 창의 기존 로그인을 지우지 않는다. 명시적 연결 해제는 두 쿠키를 만료시킨다.
- 마법사 임베드는 회사 인트라넷과 자기 origin에 한정했다. 사용하지 않는 Next.js 이미지 최적화 엔드포인트도 비활성화했다.

검증: `npm test` 9개 통과, `npm run typecheck` 통과, production build 통과. 실제 운영의 연결 확인·모델 목록·새로고침 유지는 배포 후 별도로 확인한다. 유료 이미지 생성은 검증에 사용하지 않는다.

## 기존 의존성 점검

기존 pnpm lockfile의 native audit에서 critical 2, high 16, moderate 14, low 2가 보고됐다. 이 수정은 의존성 버전을 변경하지 않으며 보안 감사 통과를 의미하지 않는다. 이미지 최적화 API 비활성화는 해당 Next.js 엔드포인트에만 적용된다. 별도 sharp 기반 업로드 처리에는 적용되지 않는다. Next.js 14와 sharp, PDF.js 등을 포함한 기존 의존성의 업데이트·영향 검토는 남아 있다. Windows 서버 관련 항목은 Linux 기반 Vercel 운영과 구분해야 한다.
