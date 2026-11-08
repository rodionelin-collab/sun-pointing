/* Direct official browser APIs. No Perplexity gateway or arbitrary proxy. */
'use strict';
window.MapProviderConfig = Object.freeze({
  hasKey(provider) {
    const field = {yandex:'yandexApiKey', google:'googleApiKey'}[provider];
    const key = field && window.MAP_CONFIG?.[field];
    return typeof key === 'string' && /^[A-Za-z0-9_-]{8,256}$/.test(key.trim());
  },
  scriptURL(provider) {
    if (!this.hasKey(provider)) throw new Error('MAP_API_KEY_NOT_CONFIGURED');
    if (provider === 'yandex') {
      const url = new URL('https://api-maps.yandex.ru/2.1/');
      url.searchParams.set('apikey', window.MAP_CONFIG.yandexApiKey.trim());
      url.searchParams.set('lang', 'ru_RU');
      url.searchParams.set('coordorder', 'latlong');
      return url.href;
    }
    if (provider === 'google') {
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.searchParams.set('key', window.MAP_CONFIG.googleApiKey.trim());
      url.searchParams.set('callback', 'dtkGoogleReady');
      url.searchParams.set('loading', 'async');
      url.searchParams.set('v', 'quarterly');
      url.searchParams.set('language', 'ru');
      url.searchParams.set('auth_referrer_policy', 'origin');
      return url.href;
    }
    throw new Error('UNKNOWN_MAP_PROVIDER');
  }
});
