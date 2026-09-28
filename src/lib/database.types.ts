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
      categories: Table<CategoryRow, 'key' | 'label' | 'type' | 'color', Generated | 'sort_order'>
      cycles: Table<CycleRow, 'key' | 'label' | 'start_date' | 'end_date', Generated | 'is_baseline'>
      income: Table<IncomeRow, 'cycle_id' | 'date' | 'source' | 'amount', Generated | 'received' | 'note'>
      fixed_expenses: Table<
        FixedExpenseRow,
        'cycle_id' | 'date' | 'item' | 'amount',
        Generated | 'paid' | 'source' | 'note'
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
    }
    Views: { [_ in never]: never }
    Functions: {
      set_baseline_cycle: { Args: { p_cycle_id: string }; Returns: undefined }
      /** Normalleştirilmiş içe aktarma dosyası (bkz. src/lib/transfer.ts) → eklenen/güncellenen sayılar. */
      import_data: { Args: { p_data: unknown }; Returns: ImportSummary }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
