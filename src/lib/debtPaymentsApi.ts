/**
 * Borç ödemeleri — Supabase işlemleri (RLS: yalnız kullanıcının kendi satırları).
 * Bakiye veritabanında tetikleyiciyle aynı işlemde güncellenir; her işlemden
 * sonra borcun güncel satırı okunup döndürülür.
 */
import type { DebtPaymentRow, DebtRow } from './database.types'
import type { PaymentFormValue } from './debtPayments'
import { cachedLoad } from './offlineCache'
import { supabase } from './supabase'

export function loadPayments(): Promise<DebtPaymentRow[]> {
  return cachedLoad('debt-payments', async () => {
    const { data, error } = await supabase.from('debt_payments').select('*').order('date', { ascending: false })
    if (error) throw error
    return data
  })
}

async function loadDebt(id: string): Promise<DebtRow> {
  const { data, error } = await supabase.from('debts').select('*').eq('id', id).single()
  if (error) throw error
  return data
}

export async function addPayment(debtId: string, value: PaymentFormValue): Promise<{ payment: DebtPaymentRow; debt: DebtRow }> {
  const { data, error } = await supabase
    .from('debt_payments')
    .insert({ ...value, debt_id: debtId })
    .select('*')
    .single()
  if (error) throw error
  return { payment: data, debt: await loadDebt(debtId) }
}

export async function updatePayment(row: DebtPaymentRow, value: PaymentFormValue): Promise<{ payment: DebtPaymentRow; debt: DebtRow }> {
  const { data, error } = await supabase.from('debt_payments').update(value).eq('id', row.id).select('*').single()
  if (error) throw error
  return { payment: data, debt: await loadDebt(row.debt_id) }
}

export async function deletePayment(row: DebtPaymentRow): Promise<DebtRow> {
  const { error } = await supabase.from('debt_payments').delete().eq('id', row.id)
  if (error) throw error
  return loadDebt(row.debt_id)
}
