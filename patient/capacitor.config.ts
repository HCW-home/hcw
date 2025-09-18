import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.healthcare.patient',
  appName: 'Healthcare Patient',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: ['*']
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'Default',
      splashFullScreen: false,
      splashImmersive: false
    }
  }
};

export default config;
