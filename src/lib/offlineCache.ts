/**
 * Çevrimdışı veri gösterimi — son görülen veri, kullanıcıya özel, IndexedDB'de.
 *
 * - Çevrimiçiyken her ekranın yüklediği veri önbelleğe yazılır (anahtar: [kullanıcı, veri]).
 * - Çevrimdışıyken (ya da ağ hatasında) aynı kullanıcının son görülen verisi döner;
 *   başka kullanıcının kaydı hiçbir koşulda okunmaz.
 * - Çıkışta önbellek tamamen silinir (AuthProvider → clearOfflineCache).
 *
 * Service worker bu veriyi önbelleğe ALMAZ (Supabase istekleri SW'den geçmez);
 * önbellek yalnızca bu modül üzerinden, oturum açmış kullanıcı için tutulur.
 */

const DB_NAME = 'butcem-offline'
const STORE = 'entries'
const VERSION = 1

export interface CacheEntry<T = unknown> {
  userId: string
  key: string
  value: T
  savedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null
let activeUser: string | null = null

/** Oturum değişince AuthProvider çağırır. null: önbellek kapalı. */
export function setCacheUser(userId: string | null): void {
  activeUser = userId
}

export function cacheUser(): string | null {
  return activeUser
}

/**
 * Oturum olayı (AuthProvider → onAuthStateChange): önbellek oturumdaki kullanıcıya
 * bağlanır; çıkışta son görülen veri tamamen silinir.
 */
export async function handleAuthChange(event: string, userId: string | null): Promise<void> {
  setCacheUser(userId)
  if (event === 'SIGNED_OUT') await clearOfflineCache()
}

function idb(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB
  } catch {
    return null
  }
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  const factory = idb()
  if (!factory) return Promise.reject(new Error('IndexedDB yok'))
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = factory.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['userId', 'key'] })
        store.createIndex('byUser', 'userId')
      }
    }
    req.onsuccess = () => {
      const db = req.result
      // Başka sekme silmek isterse bağlantıyı bırak.
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    req.onerror = () => {
      dbPromise = null
      reject(req.error)
    }
  })
  return dbPromise
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const req = fn(tx.objectStore(STORE))
        tx.oncomplete = () => resolve(req ? req.result : undefined)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export async function cacheSet<T>(userId: string, key: string, value: T): Promise<void> {
  const entry: CacheEntry<T> = { userId, key, value, savedAt: Date.now() }
  await run('readwrite', (s) => s.put(entry))
}

export async function cacheGet<T>(userId: string, key: string): Promise<CacheEntry<T> | null> {
  const entry = (await run<CacheEntry<T>>('readonly', (s) => s.get([userId, key]) as IDBRequest<CacheEntry<T>>)) ?? null
  // Anahtar zaten kullanıcıyı içerir; yine de savunmacı kontrol.
  return entry && entry.userId === userId ? entry : null
}

/** Bir kullanıcının tüm kayıtlarını siler. */
export async function cacheClearUser(userId: string): Promise<void> {
  await run('readwrite', (s) => s.delete(IDBKeyRange.bound([userId, ''], [userId, '￿'])))
}

/** Önbelleği tamamen siler (çıkış). Hata yutulur: önbellek hiç açılamadıysa silinecek bir şey yoktur. */
export async function clearOfflineCache(): Promise<void> {
  try {
    await run('readwrite', (s) => s.clear())
  } catch {
    // IndexedDB kullanılamıyor.
  }
}

// ---------------------------------------------------------------------------
// Yükleyici sarmalayıcı
// ---------------------------------------------------------------------------

/** Ağ kaynaklı hata mı? (Sunucu / yetki hataları önbellekle örtülmez.) */
export function isOfflineError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e)
  return /failed to fetch|networkerror|network request failed|load failed|internet|offline/i.test(msg)
}

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

/**
 * Veriyi yükler. Çevrimiçiyken sonucu önbelleğe yazar; çevrimdışıysa ya da ağ
 * hatası olursa aynı kullanıcının son görülen verisini döner (yoksa hatayı fırlatır).
 */
export async function cachedLoad<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const userId = activeUser
  if (!userId) return loader()

  if (!isOffline()) {
    try {
      const value = await loader()
      // Bu arada çıkış yapıldıysa (ya da kullanıcı değiştiyse) yazma.
      if (activeUser === userId) await cacheSet(userId, key, value).catch(() => {})
      return value
    } catch (e) {
      if (!isOfflineError(e)) throw e
      const cached = await cacheGet<T>(userId, key).catch(() => null)
      if (cached) return cached.value
      throw e
    }
  }

  const cached = await cacheGet<T>(userId, key).catch(() => null)
  if (cached) return cached.value
  throw new TypeError('Failed to fetch (çevrimdışı; önbellekte veri yok)')
}
