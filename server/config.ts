import { ApiError } from './errors.js';

// Supabase's URL and publishable/anon key are public configuration. Reuse the
// frontend pair on the server so first-time setup only needs three values.
// Preserve complete server-specific pairs for existing deployments.
export function supabaseConfig(env: NodeJS.ProcessEnv = process.env) {
  if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
    return { url: env.SUPABASE_URL, key: env.SUPABASE_ANON_KEY };
  }
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) {
    return { url: env.VITE_SUPABASE_URL, key: env.VITE_SUPABASE_ANON_KEY };
  }
  throw new ApiError(503, 'Supabase 주소와 공개 키를 Vercel 환경변수에 설정하세요.');
}
