import { describe, expect, it } from 'vitest'
import { loadErrorText } from './loadError'

describe('loadErrorText', () => {
  it('ağ hatası → çevrimdışı mesajı', () => {
    expect(loadErrorText('veriler', 'TypeError: Failed to fetch')).toBe(
      'Çevrimdışı görünüyorsun; veriler şu an yüklenemiyor. Bağlantı gelince sayfayı yenile.',
    )
  })
  it('diğer hatalar olduğu gibi', () => {
    expect(loadErrorText('borçlar', 'permission denied')).toBe('Borçlar yüklenemedi: permission denied')
  })
})
