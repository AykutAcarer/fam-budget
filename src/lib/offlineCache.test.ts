import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedLoad,
  cacheClearUser,
  cacheGet,
  cacheSet,
  clearOfflineCache,
  handleAuthChange,
  isOfflineError,
  setCacheUser,
} from './offlineCache'

const A = 'user-a'
const B = 'user-b'

const setOnline = (online: boolean) => vi.stubGlobal('navigator', { onLine: online })
const netError = () => Promise.reject(new TypeError('Failed to fetch'))

beforeEach(async () => {
  setOnline(true)
  setCacheUser(null)
  await clearOfflineCache()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('çevrimiçi yükleme → önbellek → çevrimdışı gösterim', () => {
  it('çevrimiçiyken yüklenen veri çevrimdışıyken aynen döner', async () => {
    setCacheUser(A)
    const data = { debts: [{ id: '1', name: 'Kart', balance: 100.5 }] }
    expect(await cachedLoad('debts', async () => data)).toEqual(data)

    setOnline(false)
    const loader = vi.fn(netError)
    expect(await cachedLoad('debts', loader)).toEqual(data)
    expect(loader).not.toHaveBeenCalled() // çevrimdışıyken ağ denenmez
  })

  it('son yükleme öncekinin üzerine yazar', async () => {
    setCacheUser(A)
    await cachedLoad('k', async () => 1)
    await cachedLoad('k', async () => 2)
    setOnline(false)
    expect(await cachedLoad('k', netError)).toBe(2)
  })

  it('çevrimiçi görünüp ağ hatası olursa da önbellek kullanılır', async () => {
    setCacheUser(A)
    await cachedLoad('k', async () => 'eski')
    expect(await cachedLoad('k', netError)).toBe('eski')
  })

  it('sunucu / yetki hatası önbellekle örtülmez', async () => {
    setCacheUser(A)
    await cachedLoad('k', async () => 'eski')
    await expect(cachedLoad('k', () => Promise.reject({ message: 'permission denied for table debts' }))).rejects.toMatchObject({
      message: 'permission denied for table debts',
    })
  })

  it('çevrimdışı ve önbellek boşsa ağ hatası fırlatılır', async () => {
    setCacheUser(A)
    setOnline(false)
    await expect(cachedLoad('yok', netError)).rejects.toThrow(/Failed to fetch/)
  })

  it('oturum yoksa önbelleğe yazılmaz', async () => {
    expect(await cachedLoad('k', async () => 'x')).toBe('x')
    expect(await cacheGet(A, 'k')).toBeNull()
  })
})

describe('kullanıcıya özel', () => {
  it('başka kullanıcı önceki kullanıcının verisini göremez', async () => {
    setCacheUser(A)
    await cachedLoad('budget', async () => ({ sahibi: 'A' }))

    setCacheUser(B)
    setOnline(false)
    await expect(cachedLoad('budget', netError)).rejects.toThrow()
    expect(await cacheGet(B, 'budget')).toBeNull()
    expect(await cacheGet(A, 'budget')).toMatchObject({ value: { sahibi: 'A' } })
  })

  it('yükleme sürerken kullanıcı değişirse (çıkış) sonuç önbelleğe yazılmaz', async () => {
    setCacheUser(A)
    await cachedLoad('k', async () => {
      setCacheUser(null)
      return 'geç gelen'
    })
    expect(await cacheGet(A, 'k')).toBeNull()
  })

  it('cacheClearUser yalnız o kullanıcının kayıtlarını siler', async () => {
    await cacheSet(A, 'x', 1)
    await cacheSet(A, 'y', 2)
    await cacheSet(B, 'x', 3)
    await cacheClearUser(A)
    expect(await cacheGet(A, 'x')).toBeNull()
    expect(await cacheGet(A, 'y')).toBeNull()
    expect(await cacheGet(B, 'x')).toMatchObject({ value: 3 })
  })
})

describe('çıkış', () => {
  it('SIGNED_OUT önbelleği tamamen siler ve kullanıcıyı bırakır', async () => {
    await handleAuthChange('SIGNED_IN', A)
    await cachedLoad('budget', async () => 'A verisi')
    await cacheSet(B, 'budget', 'B verisi')

    await handleAuthChange('SIGNED_OUT', null)
    expect(await cacheGet(A, 'budget')).toBeNull()
    expect(await cacheGet(B, 'budget')).toBeNull()

    // Çıkıştan sonra (oturum yok) çevrimdışı yükleme önbellekten veri döndürmez
    setOnline(false)
    await expect(cachedLoad('budget', netError)).rejects.toThrow()
  })

  it('oturum yenileme (TOKEN_REFRESHED) önbelleği silmez', async () => {
    await handleAuthChange('SIGNED_IN', A)
    await cachedLoad('k', async () => 1)
    await handleAuthChange('TOKEN_REFRESHED', A)
    expect(await cacheGet(A, 'k')).toMatchObject({ value: 1 })
  })
})

describe('isOfflineError', () => {
  it.each([
    [new TypeError('Failed to fetch'), true],
    [{ message: 'TypeError: NetworkError when attempting to fetch resource.' }, true],
    [new TypeError('Load failed'), true],
    [{ message: 'JWT expired' }, false],
    [new Error('duplicate key value'), false],
  ])('%s → %s', (e, expected) => {
    expect(isOfflineError(e)).toBe(expected)
  })
})
