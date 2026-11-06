export type ConnectionIssue = { field: 'url' | 'key'; message: string };
export type PublicConnection =
  { ok: true; url: string; key: string } | { ok: false; issues: ConnectionIssue[] };

export function isPrivateSupabaseKey(value: string): boolean {
  const key = value.trim().replace(/^["']|["']$/g, '');
  if (key.includes('sb_secret_')) return true;
  try {
    const parts = key.replace(/^[A-Z_]+\s*=\s*/, '').split('.');
    return (
      parts.length === 3 &&
      JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'
    );
  } catch {
    return false;
  }
}

// This checks configuration syntax, not account authorization or key validity.
// No original key or URL is ever included in an error message.
export function validateConnection(rawUrl: unknown, rawKey: unknown): PublicConnection {
  const issues: ConnectionIssue[] = [];
  const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
  const key = typeof rawKey === 'string' ? rawKey.trim() : '';
  let parsed: URL | undefined;
  if (!url || url.includes('YOUR_PROJECT')) {
    issues.push({ field: 'url', message: 'Supabase의 Project URL을 입력하세요.' });
  } else {
    try {
      parsed = new URL(url);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
      if (
        !(parsed.protocol === 'https:' || (local && parsed.protocol === 'http:')) ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash
      )
        throw new Error('invalid URL');
      if (
        [
          'supabase.com',
          'www.supabase.com',
          'app.supabase.com',
          'vercel.com',
          'www.vercel.com',
        ].includes(parsed.hostname) ||
        parsed.hostname.endsWith('.vercel.app') ||
        parsed.hostname.endsWith('.storage.supabase.co') ||
        /^db\..*\.supabase\.co$/.test(parsed.hostname)
      ) {
        issues.push({
          field: 'url',
          message:
            '관리 화면·배포 주소·Storage 주소가 아닌 Supabase Project URL을 입력하세요. 예: https://프로젝트ID.supabase.co',
        });
      } else if (
        parsed.pathname !== '/' &&
        !(
          /^[a-z0-9-]+\.supabase\.co$/.test(parsed.hostname) &&
          /^\/(?:rest|auth|storage)\/v1\/?$/.test(parsed.pathname)
        )
      ) {
        issues.push({
          field: 'url',
          message:
            'Project URL에는 /auth/v1, /rest/v1, /dashboard 같은 경로를 붙이지 마세요. 프로젝트의 기본 주소만 입력하세요.',
        });
      }
    } catch {
      issues.push({
        field: 'url',
        message:
          'Supabase Project URL은 https://로 시작하는 주소입니다. DB 접속 문자열·따옴표·설정 이름을 함께 넣지 마세요.',
      });
    }
  }
  if (!key || key.includes('YOUR_SUPABASE')) {
    issues.push({
      field: 'key',
      message: '같은 프로젝트의 publishable 또는 anon 공개 키를 입력하세요.',
    });
  } else if (isPrivateSupabaseKey(key)) {
    issues.push({
      field: 'key',
      message:
        '비밀 키는 화면 설정에 사용할 수 없습니다. 해당 키를 Supabase에서 교체하고 publishable/anon 공개 키로 다시 배포하세요.',
    });
  } else if (!/^[A-Za-z0-9._-]+$/.test(key) || key.length > 5000) {
    issues.push({
      field: 'key',
      message: '공개 키 값만 입력하세요. URL·따옴표·설정 이름은 넣지 마세요.',
    });
  }
  // A standard hosted Supabase service base (e.g. /rest/v1/) is an unambiguous
  // copy/paste variant of the same project origin. SDKs append their own paths,
  // so return the origin for both browser and server. Unknown paths stay blocked.
  return issues.length || !parsed ? { ok: false, issues } : { ok: true, url: parsed.origin, key };
}

export function authErrorText(error: unknown): string {
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : '계정 연결을 완료하지 못했습니다.';
  if (/Invalid path specified in request URL/i.test(message)) {
    return 'Supabase 인증 요청 경로가 올바르지 않습니다. Vercel의 VITE_SUPABASE_URL이 Project URL인지 확인하세요. 예: https://프로젝트ID.supabase.co. /auth/v1 또는 /rest/v1 경로는 넣지 않습니다. 수정한 뒤 Vercel에서 Redeploy하고 새로고침하세요.';
  }
  if (/invalid api key|no api key found/i.test(message)) {
    return 'Supabase 공개 키를 확인하지 못했습니다. Project URL과 같은 프로젝트의 publishable/anon 키인지 확인하고 다시 배포하세요.';
  }
  if (/email not confirmed/i.test(message)) return '본인 이메일의 인증 메일을 먼저 확인해 주세요.';
  if (/invalid login credentials/i.test(message))
    return '이메일 또는 비밀번호를 확인하세요. 처음 연결하는 경우 계정을 한 번 만들어야 합니다.';
  if (/signups? not allowed|signup.*disabled/i.test(message))
    return '이 프로젝트의 새 계정 생성이 꺼져 있습니다. 이미 만든 본인 계정으로 로그인하거나 Supabase의 사용자 설정을 확인하세요.';
  if (/failed to fetch|networkerror|load failed/i.test(message))
    return 'Supabase에 연결하지 못했습니다. 프로젝트 주소와 네트워크 상태를 확인하세요.';
  return message;
}
