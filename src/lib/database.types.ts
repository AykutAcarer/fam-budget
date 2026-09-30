/**
 * Veritabanı tipleri — supabase/migrations ile uyumlu, elle yazılmıştır.
 * Şema değişince güncelleyin veya şu komutla üretin:
 *   npx supabase gen types typescript --project-id <id> > src/lib/database.types.ts
 *
 * Not: Postgres numeric sütunları PostgREST üzerinden JSON number olarak gelir.
 */

export type CategoryType = 'zorunlu' | 'kisilabilir' | 'yari' | 'borc'

type Table<Row, Required extends keyof Row, Optional extends keyof Row> = {
  Row: Row
  Insert: Pick<Row, Required> & Partial<Pick<Row, Optional>>
  Update: Partial<Row>
  Relationships: []
}

type Generated = 'id' | 'user_id' | 'created_at'

export type CategoryRow = {
  id: string
  user_id: string
  key: string
  label: string
  type: CategoryType
  color: string
  sort_order: number
  /** Yedek parser anahtar kelimeleri. */
  keywords: string[]
  /** Kısılabilir mi (baz ay kıyasına ve tekrar hatırlatmasına dahil)? Kullanıcı seçer. */
  is_cuttable: boolean
  created_at: string
}

export type CycleRow = {
  id: string
  user_id: string
  key: string
  label: string
  start_date: string
  end_date: string
  is_baseline: boolean
  created_at: string
}

export type IncomeRow = {
  id: string
  user_id: string
  cycle_id: string
  date: string
  source: string
  amount: number
  received: boolean
  note: string | null
  /** Her döngüde tekrar eder mi (devirde taşınır)? */
  recurring: boolean
  created_at: string
}

export type FixedExpenseRow = {
  id: string
  user_id: string
  cycle_id: string
  date: string
  item: string
  amount: number
  paid: boolean
  source: string | null
  note: string | null
  /** Kalan taksit sayısı (bu döngününki dahil); taksit değilse null. */
  installments_left: number | null
  /** Her döngüde tekrar eder mi (devirde taşınır)? */
  recurring: boolean
  created_at: string
}

export type VariableExpenseRow = {
  id: string
  user_id: string
  cycle_id: string
  date: string
  category: string
  description: string
  amount: number
  created_at: string
}

export type DebtRow = {
  id: string
  user_id: string
  name: string
  balance: number
  interest: string | null
  has_interest: boolean
  due_date: string | null
  priority: number
  note: string | null
  created_at: string
}

/** Borca yapılan ödeme. Eklenince/silinince/düzenlenince borcun bakiyesi tetikleyiciyle güncellenir. */
export type DebtPaymentRow = {
  id: string
  user_id: string
  debt_id: string
  date: string
  amount: number
  note: string | null
  created_at: string
}

/** Sohbet mesajı. id istemcide üretilir (çevrimdışı kuyruktan upsert, kopya olmaz). */
export type ChatMessageRow = {
  id: string
  user_id: string
  role: 'user' | 'assistant'
  content: string
  meta: Record<string, unknown>
  related_expense_id: string | null
  created_at: string
}

/** import_data RPC'sinin döndürdüğü sayılar. */
export type ImportSummary = {
  categories: number
  debts: number
  cycles: number
  income: number
  fixed: number
  variable: number
}

export interface Database {
  public: {
    Tables: {
      categories: Table<CategoryRow, 'key' | 'label' | 'type' | 'color', Generated | 'sort_order' | 'keywords' | 'is_cuttable'>
      cycles: Table<CycleRow, 'key' | 'label' | 'start_date' | 'end_date', Generated | 'is_baseline'>
      income: Table<IncomeRow, 'cycle_id' | 'date' | 'source' | 'amount', Generated | 'received' | 'note' | 'recurring'>
      fixed_expenses: Table<
        FixedExpenseRow,
        'cycle_id' | 'date' | 'item' | 'amount',
        Generated | 'paid' | 'source' | 'note' | 'installments_left' | 'recurring'
      >
      variable_expenses: Table<
        VariableExpenseRow,
        'cycle_id' | 'date' | 'category' | 'amount',
        Generated | 'description'
      >
      debts: Table<
        DebtRow,
        'name' | 'balance',
        Generated | 'interest' | 'has_interest' | 'due_date' | 'priority' | 'note'
      >
      debt_payments: Table<DebtPaymentRow, 'debt_id' | 'date' | 'amount', Generated | 'note'>
      chat_messages: Table<ChatMessageRow, 'id' | 'role' | 'content', 'user_id' | 'created_at' | 'meta' | 'related_expense_id'>
    }
    Views: { [_ in never]: never }
    Functions: {
      set_baseline_cycle: { Args: { p_cycle_id: string }; Returns: undefined }
      /** Normalleştirilmiş içe aktarma dosyası (bkz. src/lib/transfer.ts) → eklenen/güncellenen sayılar. */
      import_data: { Args: { p_data: unknown }; Returns: ImportSummary }
      /** Kaynak döngüden sonraki döngüyü üretir (idempotent) → yeni döngünün id'si. */
      roll_forward_cycle: { Args: { p_cycle_id: string }; Returns: string }
      /** Taşınan harcama sayısını döner. */
      delete_category: { Args: { p_key: string; p_move_to?: string | null }; Returns: number }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
