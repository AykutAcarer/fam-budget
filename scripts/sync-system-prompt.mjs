// app_system_prompt.md → supabase/functions/chat-expense/system_prompt.ts
// Edge Function system mesajını md dosyasının TAMAMINDAN üretir. md değişince çalıştır:
//   npm run sync:prompt
// (Bir test, üretilen dosyanın md ile aynı olduğunu kontrol eder.)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const prompt = readFileSync(join(root, 'app_system_prompt.md'), 'utf8').replace(/\r\n/g, '\n')
const out = `// OTOMATİK ÜRETİLDİ — elle düzenleme. Kaynak: app_system_prompt.md (npm run sync:prompt)
export const SYSTEM_PROMPT: string = ${JSON.stringify(prompt)}
`
writeFileSync(join(root, 'supabase', 'functions', 'chat-expense', 'system_prompt.ts'), out)
console.log(`system_prompt.ts güncellendi (${prompt.length} karakter)`)
