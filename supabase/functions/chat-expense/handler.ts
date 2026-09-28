/**
 * chat-expense — istek işleyici (platformdan bağımsız, test edilebilir).
 *
 * Deno'ya özgü hiçbir şey içermez; ortam değişkenleri, fetch ve kullanıcı
 * doğrulaması dışarıdan verilir (bkz. index.ts). Vitest ile test edilir.
 *
 * İki mod:
 *  - parse: serbest Türkçe metni harcamalara ayırır (kıyas rakamı YOK).
 *  - reply: uygulamanın KODLA hesapladığı kıyas rakamlarıyla motive edici
 *           cevap yazar. Yapay zeka matematik yapmaz; rakamları olduğu gibi kullanır.
 *
 * Claude'a tek bir tool (harcama_kaydet) verilir ve tool_choice ile zorlanır;
 * cevaptaki tool_use.input doğrudan kullanılır (serbest metin JSON ayrıştırma yok).
 */

export const TOOL_NAME = 'harcama_kaydet'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const MAX_TOKENS = 500
const UPSTREAM_TIMEOUT_MS = 20_000
const MAX_MESSAGE_LENGTH = 500

/** Bağlam kategori listesi gelmezse kullanılan varsayılan 10 kategori. */
export const DEFAULT_CATEGORY_KEYS = [
  'mutfak', 'yakit', 'mensemax', 'kahvalti', 'is', 'halisaha', 'sosyal', 'temizlik', 'hanim', 'kredi karti',
] as const

// ---------------------------------------------------------------------------
// Tipler (istemciyle paylaşılan sözleşme)
// ---------------------------------------------------------------------------

export type ChatMode = 'parse' | 'reply'

export interface ChatCategory {
  key: string
  label: string
}

export interface ComparisonPayload {
  cycleDay: number
  dortluBuAy: number
  dortluBazAy: number
  fark: number
  kategoriBuAy: number | null
  kategoriBazAyTumAy: number | null
}

export interface SavedExpense {
  amount: number
  category: string
  date: string
  description: string
}

export interface ChatContext {
  today: string
  cycle?: { label: string; start: string; end: string }
  categories: ChatCategory[]
  /** Yalnızca reply modunda: kodla hesaplanmış kıyas (baz ay yoksa null). */
  comparison?: ComparisonPayload | null
  /** Yalnızca reply modunda: az önce kaydedilen kalemler. */
  saved?: SavedExpense[]
}

export interface ChatRequest {
  mode: ChatMode
  message: string
  context: ChatContext
}

export interface ParsedExpense {
  amount: number
  category: string
  date: string
  description: string
  needsConfirm: boolean
}

export interface ChatResult {
  expenses: ParsedExpense[]
  reply: string
  clarify: string | null
}

export interface HandlerDeps {
  env: (name: string) => string | undefined
  fetch: typeof fetch
  /** Authorization başlığındaki JWT'yi doğrular; geçerli kullanıcıysa id, değilse null. */
  verifyUser: (req: Request) => Promise<string | null>
  systemPrompt: string
}

// ---------------------------------------------------------------------------
// HTTP yardımcıları
// ---------------------------------------------------------------------------

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

// ---------------------------------------------------------------------------
// İstek doğrulama
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Gövdeyi doğrular; geçersizse hata mesajı döner. */
export function parseChatRequest(body: unknown): ChatRequest | string {
  if (!isObj(body)) return 'Gövde JSON nesnesi olmalı'
  const { mode, message, context } = body
  if (mode !== 'parse' && mode !== 'reply') return "mode 'parse' veya 'reply' olmalı"
  if (typeof message !== 'string' || !message.trim()) return 'message boş olamaz'
  if (message.length > MAX_MESSAGE_LENGTH) return `message en fazla ${MAX_MESSAGE_LENGTH} karakter olabilir`
  if (!isObj(context) || typeof context.today !== 'string' || !ISO_DATE.test(context.today))
    return 'context.today YYYY-MM-DD olmalı'

  let categories: ChatCategory[] = DEFAULT_CATEGORY_KEYS.map((key) => ({ key, label: key }))
  if (Array.isArray(context.categories) && context.categories.length > 0) {
    if (context.categories.length > 50) return 'context.categories en fazla 50 kalem olabilir'
    categories = []
    for (const c of context.categories) {
      if (!isObj(c) || typeof c.key !== 'string' || !c.key.trim()) return 'context.categories geçersiz'
      categories.push({ key: c.key, label: typeof c.label === 'string' ? c.label : c.key })
    }
  }

  const ctx: ChatContext = { today: context.today, categories }
  if (isObj(context.cycle)) {
    const { label, start, end } = context.cycle
    if (typeof label === 'string' && typeof start === 'string' && typeof end === 'string') ctx.cycle = { label, start, end }
  }

  if (mode === 'reply') {
    if (context.comparison === null || context.comparison === undefined) {
      ctx.comparison = null
    } else {
      const c = context.comparison
      if (!isObj(c) || !isNum(c.cycleDay) || !isNum(c.dortluBuAy) || !isNum(c.dortluBazAy) || !isNum(c.fark))
        return 'context.comparison geçersiz'
      ctx.comparison = {
        cycleDay: c.cycleDay,
        dortluBuAy: c.dortluBuAy,
        dortluBazAy: c.dortluBazAy,
        fark: c.fark,
        kategoriBuAy: isNum(c.kategoriBuAy) ? c.kategoriBuAy : null,
        kategoriBazAyTumAy: isNum(c.kategoriBazAyTumAy) ? c.kategoriBazAyTumAy : null,
      }
    }
    ctx.saved = Array.isArray(context.saved)
      ? context.saved.filter(isObj).slice(0, 20).map((s) => ({
          amount: isNum(s.amount) ? s.amount : 0,
          category: String(s.category ?? ''),
          date: String(s.date ?? ''),
          description: String(s.description ?? ''),
        }))
      : []
  }

  return { mode, message: message.trim(), context: ctx }
}

// ---------------------------------------------------------------------------
// Claude isteği
// ---------------------------------------------------------------------------

/** harcama_kaydet tool'u. Kategori enum'u kullanıcının kategorilerinden üretilir. */
export function buildTool(categoryKeys: readonly string[]) {
  return {
    name: TOOL_NAME,
    description:
      'Kullanıcının mesajındaki harcamaları yapılandırılmış olarak kaydeder ve kullanıcıya gösterilecek kısa Türkçe cevabı iletir. Her cevapta bu aracı tam olarak bir kez kullan.',
    strict: true,
    input_schema: {
      type: 'object',
      additionalProperties: false,
      required: ['expenses', 'reply', 'clarify'],
      properties: {
        expenses: {
          type: 'array',
          description: 'Mesajdaki harcama kalemleri; harcama yoksa boş dizi.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['amount', 'category', 'date', 'description', 'needsConfirm'],
            properties: {
              amount: { type: 'number', description: 'Euro tutarı. Türkçe ondalık virgüldür: "8,25" = 8.25' },
              category: { type: 'string', enum: [...categoryKeys], description: 'Kategori key' },
              date: { type: 'string', format: 'date', description: 'YYYY-MM-DD; varsayılan context.today' },
              description: { type: 'string', description: 'Kullanıcının kendi ifadesiyle kısa açıklama' },
              needsConfirm: { type: 'boolean', description: 'Kategoriden emin değilsen true' },
            },
          },
        },
        reply: { type: 'string', description: 'Kullanıcıya gösterilecek 1-3 cümlelik Türkçe cevap' },
        clarify: {
          anyOf: [{ type: 'string' }, { type: 'null' }],
          description: 'Kategori belirsizse kullanıcıya sorulacak kısa soru, değilse null',
        },
      },
    },
  }
}

/** Kullanıcı mesajı: görev talimatı + kullanıcının metni + JSON bağlam. */
export function buildUserContent(req: ChatRequest): string {
  const task =
    req.mode === 'parse'
      ? [
          'GÖREV 1: Yalnızca harcamayı yapılandır.',
          'Bu çağrıda kıyas rakamı YOK; reply alanına rakam veya kıyas yazma.',
          'Harcama varsa reply kısa bir onay olsun; harcama yoksa kibarca ne beklediğini söyle.',
        ]
      : [
          'GÖREV 2: Yalnızca motive edici cevabı yaz.',
          'Harcamalar zaten kaydedildi (context.saved); expenses alanını boş dizi, clarify alanını null bırak.',
          'context.comparison içindeki rakamları DEĞİŞTİRMEDEN kullan; kendin hesap yapma.',
          'context.comparison null ise baz ay seçilmemiştir: kıyas yapmadan kısa bir onay yaz.',
        ]
  return [
    ...task,
    '',
    'Kullanıcının mesajı:',
    `<mesaj>${req.message}</mesaj>`,
    '',
    'context:',
    JSON.stringify(req.context),
  ].join('\n')
}

export function buildAnthropicBody(req: ChatRequest, model: string, systemPrompt: string) {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    tools: [buildTool(req.context.categories.map((c) => c.key))],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: buildUserContent(req) }],
  }
}

// ---------------------------------------------------------------------------
// Claude cevabını doğrulama (strict şemaya rağmen savunmacı)
// ---------------------------------------------------------------------------

/** tool_use.input'u güvenli ChatResult'a çevirir; bozuk kalemleri eler. */
export function sanitizeResult(input: unknown, req: ChatRequest): ChatResult {
  const keys = new Set(req.context.categories.map((c) => c.key))
  const obj = isObj(input) ? input : {}
  const reply = typeof obj.reply === 'string' ? obj.reply.trim().slice(0, 1000) : ''
  if (req.mode === 'reply') return { expenses: [], reply, clarify: null }

  const expenses: ParsedExpense[] = []
  for (const e of Array.isArray(obj.expenses) ? obj.expenses : []) {
    if (!isObj(e) || !isNum(e.amount) || e.amount <= 0 || e.amount > 100_000) continue
    const knownCategory = typeof e.category === 'string' && keys.has(e.category)
    const fallbackCategory = keys.has('sosyal') ? 'sosyal' : [...keys][0]
    expenses.push({
      amount: Math.round(e.amount * 100) / 100,
      category: knownCategory ? (e.category as string) : fallbackCategory,
      date: typeof e.date === 'string' && ISO_DATE.test(e.date) ? e.date : req.context.today,
      description: typeof e.description === 'string' ? e.description.trim().slice(0, 200) : '',
      needsConfirm: e.needsConfirm === true || !knownCategory,
    })
  }
  const clarify = typeof obj.clarify === 'string' && obj.clarify.trim() ? obj.clarify.trim().slice(0, 300) : null
  return { expenses, reply, clarify }
}

// ---------------------------------------------------------------------------
// İşleyici
// ---------------------------------------------------------------------------

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const userId = await deps.verifyUser(req)
  if (!userId) return json({ error: 'unauthorized' }, 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'bad_request', message: 'Gövde geçerli JSON değil' }, 400)
  }
  const parsed = parseChatRequest(body)
  if (typeof parsed === 'string') return json({ error: 'bad_request', message: parsed }, 400)

  const apiKey = deps.env('ANTHROPIC_API_KEY')
  const model = deps.env('ANTHROPIC_MODEL')
  if (!apiKey || !model) {
    console.error('chat-expense: ANTHROPIC_API_KEY veya ANTHROPIC_MODEL secret tanımlı değil')
    return json({ error: 'not_configured' }, 500)
  }

  let upstream: Response
  try {
    upstream = await deps.fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify(buildAnthropicBody(parsed, model, deps.systemPrompt)),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (err) {
    console.error('chat-expense: Anthropic isteği başarısız', err)
    return json({ error: 'upstream_unreachable' }, 502)
  }

  if (!upstream.ok) {
    // Hata gövdesi loglanır ama istemciye yalnızca durum kodu iletilir.
    console.error(`chat-expense: Anthropic ${upstream.status}`, await upstream.text().catch(() => ''))
    return json({ error: 'upstream_error', status: upstream.status }, 502)
  }

  const message = (await upstream.json()) as { stop_reason?: string; content?: { type: string; name?: string; input?: unknown }[] }
  if (message.stop_reason === 'refusal' || message.stop_reason === 'max_tokens') {
    console.error(`chat-expense: kullanılamaz cevap (stop_reason=${message.stop_reason})`)
    return json({ error: 'upstream_incomplete', stopReason: message.stop_reason }, 502)
  }
  const toolUse = message.content?.find((b) => b.type === 'tool_use' && b.name === TOOL_NAME)
  if (!toolUse) return json({ error: 'upstream_no_tool_use' }, 502)

  return json(sanitizeResult(toolUse.input, parsed))
}
