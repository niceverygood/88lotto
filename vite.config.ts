import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// 고객 홈페이지(/portal) 전용 HTML — 카카오톡 등 링크 미리보기는 JS 를 실행하지 않고 HTML <head> 만 읽는다.
// 같은 번들을 쓰되 제목·설명(og:*)만 고객용으로 바꾼 portal.html 을 함께 내보내고,
// vercel.json 이 /portal·/portal/* 요청을 이 파일로 돌려준다(관리자 index.html 은 '로또 운영 콘솔' 그대로).
function portalHtml(brand: string): Plugin {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
  const title = `${brand} | AI 로또 번호 추천`
  const desc = '매주 자동 발급되는 추천 번호와 당첨 집계까지. 가입 즉시 추천번호를 받아보세요.'
  const head = [
    `<title>${esc(title)}</title>`,
    `<meta name="description" content="${esc(desc)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${esc(brand)}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(desc)}" />`,
    `<meta property="og:locale" content="ko_KR" />`,
  ].join('\n    ')
  return {
    name: 'portal-html',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const index = bundle['index.html']
      if (!index || index.type !== 'asset') return
      const html = String(index.source).replace(/<title>[^<]*<\/title>/, head)
      this.emitFile({ type: 'asset', fileName: 'portal.html', source: html })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  const brand = env.VITE_BRAND?.trim() || '88로또'
  return {
  plugins: [react(), portalHtml(brand)],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          query: ['@tanstack/react-query', '@tanstack/react-table'],
          charts: ['recharts'],
          supabase: ['@supabase/supabase-js'],
        },
      },
    },
  },
}
})
