import { ApiError } from './errors.js';
import { validateConnection } from '../src/domain/connection.js';

// Supabase's URL and publishable/anon key are public configuration. Reuse the
// frontend pair on the server so first-time setup only needs three values.
// Preserve complete server-specific pairs for existing deployments.
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  let url: string | undefined, key: string | undefined;
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    url = env.SUPABASE_URL;
    key = env.SUPABASE_ANON_KEY;
  } else if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    url = env.VITE_SUPABASE_URL;
    key = env.VITE_SUPABASE_ANON_KEY;
  } else {
    throw new ApiError(503, 'Supabase 주소와 공개 키를 Vercel 환경변수에 설정하세요.');
  }
  const checked = validateConnection(url, key);
  if (!checked.ok) throw new ApiError(503, checked.issues.map((i) => i.message).join('\n'));
  return { url: checked.url, key: checked.key };
}
