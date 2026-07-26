import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Temporary until the first TestFlight / Play Console build upload.
  appId: 'app.memory.dev',
  appName: '시험암기',
  webDir: 'dist',
  backgroundColor: '#f2f2f7',
  plugins: {
    // Native requests let the bundled app use the existing HTTPS sync server
    // without weakening that server's browser-origin policy.
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
