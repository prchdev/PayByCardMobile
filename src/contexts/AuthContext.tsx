import React, { createContext, useContext, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  registerBiometric, clearBiometricCredential, hasBiometricCredential,
} from '../utils/biometric';
import {
  getItem, setItem, removeItem,
  getSessionItem, setSessionItem, removeSessionItem,
} from '../utils/secureStorage';
import { setSessionExpiredHandler } from '../utils/api';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../utils/config';
import { getStoredPushToken } from '../utils/notifications';

interface AuthContextType {
  isAuthenticated: boolean;
  userId: string | null;
  userEmail: string | null;
  sessionToken: string | null;
  isRemembered: boolean;
  rememberedEmail: string | null;
  hasBiometric: boolean;
  login: (userId: string, email: string, sessionToken?: string) => void;
  biometricUnlock: () => Promise<{ userId: string; email: string } | null>;
  logout: () => void;
  clearRememberedSession: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const REMEMBERED_KEY = 'pbc_remembered_session';
const SESSION_USER_ID = 'userId';
const SESSION_USER_EMAIL = 'userEmail';
const SESSION_TOKEN_KEY = 'pbc_session';

async function registerPushTokenWithBackend(userId: string, sessionToken: string | null): Promise<void> {
  try {
    const pushToken = await getStoredPushToken();
    if (!pushToken) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
    if (sessionToken) {
      headers['x-pbc-session'] = sessionToken;
    }

    const appVersion = (Platform as any).constants?.Version || null;

    await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        push_token: pushToken,
        platform: Platform.OS,
        app_version: appVersion,
      }),
    });
  } catch (e) {
    console.warn('Failed to register push token with backend:', e);
  }
}

async function deregisterPushTokenWithBackend(userId: string, sessionToken: string | null): Promise<void> {
  try {
    const pushToken = await getStoredPushToken();
    if (!pushToken) return;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    };
    if (sessionToken) {
      headers['x-pbc-session'] = sessionToken;
    }

    await fetch(`${SUPABASE_URL}/functions/v1/register-push-token`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        user_id: userId,
        push_token: pushToken,
        action: 'deregister',
      }),
    });
  } catch (e) {
    console.warn('Failed to deregister push token:', e);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [isRemembered, setIsRemembered] = useState(false);
  const [rememberedEmail, setRememberedEmail] = useState<string | null>(null);
  const [hasBiometric, setHasBiometric] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      const storedUserId = await getSessionItem(SESSION_USER_ID);
      const storedEmail = await getSessionItem(SESSION_USER_EMAIL);
      const storedToken = await getSessionItem(SESSION_TOKEN_KEY);

      if (mounted && storedUserId && storedEmail) {
        setIsAuthenticated(true);
        setUserId(storedUserId);
        setUserEmail(storedEmail);
        if (storedToken) setSessionToken(storedToken);

        // Re-register push token on every app launch (Expo tokens can change)
        registerPushTokenWithBackend(storedUserId, storedToken);
      }

      try {
        const remembered = await getItem(REMEMBERED_KEY);
        if (mounted && remembered) {
          const parsed = JSON.parse(remembered);
          setIsRemembered(true);
          setRememberedEmail(parsed.email || null);
        }
      } catch {
        await removeItem(REMEMBERED_KEY);
      }

      const biometricEnrolled = await hasBiometricCredential();
      if (mounted) setHasBiometric(biometricEnrolled);
    })();

    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      (async () => {
        await removeSessionItem(SESSION_USER_ID);
        await removeSessionItem(SESSION_USER_EMAIL);
        await removeSessionItem(SESSION_TOKEN_KEY);
        await removeSessionItem('isRestricted');
      })();
      setIsAuthenticated(false);
      setUserId(null);
      setUserEmail(null);
      setSessionToken(null);
    });
  }, []);

  const login = (id: string, email: string, token?: string) => {
    (async () => {
      await setSessionItem(SESSION_USER_ID, id);
      await setSessionItem(SESSION_USER_EMAIL, email);
      if (token) await setSessionItem(SESSION_TOKEN_KEY, token);
      await setItem(REMEMBERED_KEY, JSON.stringify({ userId: id, email, sessionToken: token }));

      // Register push token with backend after login
      registerPushTokenWithBackend(id, token ?? null);
    })();

    setIsAuthenticated(true);
    setUserId(id);
    setUserEmail(email);
    if (token) setSessionToken(token);
    setIsRemembered(true);
    setRememberedEmail(email);

    registerBiometric(email).then((success) => {
      if (success) setHasBiometric(true);
    }).catch(() => {});
  };

  const biometricUnlock = async (): Promise<{ userId: string; email: string } | null> => {
    try {
      const remembered = await getItem(REMEMBERED_KEY);
      if (!remembered) return null;
      const parsed = JSON.parse(remembered);
      await setSessionItem(SESSION_USER_ID, parsed.userId);
      await setSessionItem(SESSION_USER_EMAIL, parsed.email);
      if (parsed.sessionToken) await setSessionItem(SESSION_TOKEN_KEY, parsed.sessionToken);
      setIsAuthenticated(true);
      setUserId(parsed.userId);
      setUserEmail(parsed.email);
      if (parsed.sessionToken) setSessionToken(parsed.sessionToken);

      // Validate the session token is still active before proceeding.
      // If expired, clear the session and redirect to login instead of
      // showing a dashboard with empty data.
      if (parsed.sessionToken) {
        try {
          const res = await fetch(`${SUPABASE_URL}/functions/v1/get-user-stats`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
              'Content-Type': 'application/json',
              'x-pbc-session': parsed.sessionToken,
            },
            body: JSON.stringify({ userId: parsed.userId }),
          });
          if (res.status === 401) {
            await removeSessionItem(SESSION_USER_ID);
            await removeSessionItem(SESSION_USER_EMAIL);
            await removeSessionItem(SESSION_TOKEN_KEY);
            await removeSessionItem('isRestricted');
            setIsAuthenticated(false);
            setUserId(null);
            setUserEmail(null);
            setSessionToken(null);
            return null;
          }
        } catch {
          // Network error — allow unlock, the dashboard will handle errors
        }
      }

      // Re-register push token after biometric unlock
      registerPushTokenWithBackend(parsed.userId, parsed.sessionToken ?? null);

      return { userId: parsed.userId, email: parsed.email };
    } catch {
      await removeItem(REMEMBERED_KEY);
      setIsRemembered(false);
      setRememberedEmail(null);
      return null;
    }
  };

  const logout = () => {
    const currentUserId = userId;
    const currentToken = sessionToken;

    (async () => {
      // Deregister push token before clearing session
      if (currentUserId) {
        await deregisterPushTokenWithBackend(currentUserId, currentToken);
      }
      await removeSessionItem(SESSION_USER_ID);
      await removeSessionItem(SESSION_USER_EMAIL);
      await removeSessionItem(SESSION_TOKEN_KEY);
      await removeSessionItem('isRestricted');
    })();
    setIsAuthenticated(false);
    setUserId(null);
    setUserEmail(null);
    setSessionToken(null);
  };

  const clearRememberedSession = () => {
    (async () => {
      await removeItem(REMEMBERED_KEY);
      await clearBiometricCredential();
    })();
    setIsRemembered(false);
    setRememberedEmail(null);
    setHasBiometric(false);
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, userId, userEmail, sessionToken, isRemembered, rememberedEmail, hasBiometric, login, biometricUnlock, logout, clearRememberedSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
