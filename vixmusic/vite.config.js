import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const forCapacitor = Boolean(process.env.CAPACITOR)

// https://vite.dev/config/
export default defineConfig({
  base: forCapacitor ? './' : '/vixmusic/',
  plugins: [react()],
})
