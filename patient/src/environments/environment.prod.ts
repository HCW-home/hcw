export const environment = {
  production: true,
  apiUrl: '/api',
  get wsUrl() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws`;
  },
  // Custom URL scheme registered by the native apps (matches AndroidManifest /
  // iOS). The store URLs and Android package come from the backend /config
  // (env-default, per-instance override), not from here.
  mobileAppScheme: 'hcw'
};
