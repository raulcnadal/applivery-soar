import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import dts from 'vite-plugin-dts'
import path from 'path'

export default defineConfig({
  plugins: [
    vue(),
    dts({
      insertTypesEntry: true,
      tsconfigPath: path.resolve(__dirname, 'tsconfig.json'),
    }),
  ],
  resolve: {
    alias: {
      '@/lib/utils': path.resolve(__dirname, '../../src/lib/utils.ts'),
    },
  },
  build: {
    lib: {
      entry: path.resolve(__dirname, 'src/index.ts'),
      name: 'BlueSkyVue',
      fileName: 'index',
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: ['vue', '@solar-icons/vue', 'tailwindcss'],
      output: {
        globals: { vue: 'Vue' },
      },
    },
  },
})
