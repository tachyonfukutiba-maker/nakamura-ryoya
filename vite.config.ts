import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react' // 🌟こちらに書き換えます

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/nakamura-ryoya/', // 👈ここはリポジトリ名のままでOK！
})