/** Veri yükleme hatasını kullanıcıya anlaşılır biçimde anlatır. */

const NETWORK = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

export function loadErrorText(what: string, error: string): string {
  if (NETWORK.test(error) || (typeof navigator !== 'undefined' && navigator.onLine === false))
    return `Çevrimdışı görünüyorsun; ${what} şu an yüklenemiyor. Bağlantı gelince sayfayı yenile.`
  return `${what[0].toLocaleUpperCase('tr-TR')}${what.slice(1)} yüklenemedi: ${error}`
}
