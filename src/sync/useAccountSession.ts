import { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import type { User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export type AccountProvider = 'google' | 'kakao';

const NATIVE_AUTH_CALLBACK = 'memoryapp://auth/callback';

export type AccountSession = {
  configured: boolean;
  loading: boolean;
  pending: boolean;
  user: User | null;
  error: Error | null;
  signIn: (provider: AccountProvider) => Promise<boolean>;
  signOut: () => Promise<boolean>;
  clearError: () => void;
};

function asError(value: unknown) {
  return value instanceof Error ? value : new Error('Account request failed');
}

export function useAccountSession(): AccountSession {
  const [loading, setLoading] = useState(isSupabaseConfigured);
  const [pending, setPending] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setLoading(false);
      return;
    }

    let active = true;
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: authListener } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setLoading(false);
      if (session) setError(null);
    });

    let removeAppUrlListener: (() => Promise<void>) | undefined;
    if (Capacitor.isNativePlatform()) {
      const handledUrls = new Set<string>();
      const handleNativeAuthUrl = (url: string) => {
        if (!url.startsWith(NATIVE_AUTH_CALLBACK)) return;
        if (handledUrls.has(url)) return;
        handledUrls.add(url);
        const code = new URL(url).searchParams.get('code');
        if (!code) {
          setError(new Error('OAuth callback did not include a code'));
          setPending(false);
          return;
        }
        void client.auth.exchangeCodeForSession(code)
          .then(({ error: exchangeError }) => {
            if (exchangeError) setError(exchangeError);
          })
          .catch((exchangeError) => setError(asError(exchangeError)))
          .finally(() => {
            setPending(false);
            void Browser.close().catch(() => {});
          });
      };
      void CapacitorApp.getLaunchUrl().then((launch) => {
        if (launch?.url) handleNativeAuthUrl(launch.url);
      });
      void CapacitorApp.addListener('appUrlOpen', ({ url }) => {
        handleNativeAuthUrl(url);
      }).then((listener) => {
        removeAppUrlListener = () => listener.remove();
      });
    }

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
      void removeAppUrlListener?.();
    };
  }, []);

  const signIn = useCallback(async (provider: AccountProvider) => {
    if (!supabase || pending) return false;
    setPending(true);
    setError(null);
    try {
      const native = Capacitor.isNativePlatform();
      const { data, error: signInError } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: native ? NATIVE_AUTH_CALLBACK : window.location.origin,
          skipBrowserRedirect: native,
        },
      });
      if (signInError) throw signInError;
      if (native) {
        if (!data.url) throw new Error('OAuth provider URL was unavailable');
        await Browser.open({ url: data.url });
      } else {
        // The web flow navigates away. Keep the pending state so the button
        // cannot issue a second authorization request before that happens.
        return true;
      }
      return true;
    } catch (signInError) {
      setError(asError(signInError));
      setPending(false);
      return false;
    }
  }, [pending]);

  const signOut = useCallback(async () => {
    if (!supabase || pending) return false;
    setPending(true);
    setError(null);
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      return true;
    } catch (signOutError) {
      setError(asError(signOutError));
      return false;
    } finally {
      setPending(false);
    }
  }, [pending]);

  return {
    configured: isSupabaseConfigured,
    loading,
    pending,
    user,
    error,
    signIn,
    signOut,
    clearError: useCallback(() => setError(null), []),
  };
}
