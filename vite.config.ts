import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { isPrivateSupabaseKey } from './src/domain/connection';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (isPrivateSupabaseKey(env.VITE_SUPABASE_ANON_KEY || ''))
    throw new Error(
      'VITE_SUPABASE_ANON_KEY에는 publishable/anon 공개 키를 사용하세요. 비밀 키가 브라우저에 포함되지 않도록 빌드를 중단했습니다.',
    );
  return {
    plugins: [react()],
    build: {
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks: {
            react: ['react', 'react-dom/client'],
            supabase: ['@supabase/supabase-js'],
            validation: ['zod'],
          },
        },
      },
    },
  };
});
