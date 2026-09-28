/**
 * Çevrimdışı kuyruk: internet yokken girilen harcamalar cihazda bekler ve
 * bağlantı gelince gönderilir. Her kalemin istemcide üretilmiş sabit bir id'si
 * vardır; tekrar gönderim kopya oluşturmaz (insert ... on conflict do nothing).
 */

export interface NewExpense {
  id: string
  date: string
  category: string
  description: string
  amount: number
}

const key = (userId: string) => `butcem:outbox:${userId}`

export function readOutbox(userId: string): NewExpense[] {
  try {
    const raw = localStorage.getItem(key(userId))
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? (list as NewExpense[]) : []
  } catch {
    return []
  }
}

function write(userId: string, items: NewExpense[]) {
  try {
    if (items.length) localStorage.setItem(key(userId), JSON.stringify(items))
    else localStorage.removeItem(key(userId))
  } catch {
    // Depolama kapalıysa kuyruk bu oturumla sınırlı kalır.
  }
}

export function addToOutbox(userId: string, items: NewExpense[]) {
  const current = readOutbox(userId)
  const ids = new Set(current.map((i) => i.id))
  write(userId, [...current, ...items.filter((i) => !ids.has(i.id))])
}

export function removeFromOutbox(userId: string, ids: Iterable<string>) {
  const drop = new Set(ids)
  write(userId, readOutbox(userId).filter((i) => !drop.has(i.id)))
}
