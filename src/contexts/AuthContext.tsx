import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  registerBiometric, clearBiometricCredential, hasBiometricCredential,
} from '../utils/biometric';
import {
  getItem, setItem, removeItem,
  getSessionItem, setSessionItem, removeSessionItem,
} from '../utils/secureStorage';

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

  const login = (id: string, email: string, token?: string) => {
    (async () => {
      await setSessionItem(SESSION_USER_ID, id);
      await setSessionItem(SESSION_USER_EMAIL, email);
      if (token) await setSessionItem(SESSION_TOKEN_KEY, token);
      await setItem(REMEMBERED_KEY, JSON.stringify({ userId: id, email, sessionToken: token }));
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
      return { userId: parsed.userId, email: parsed.email };
    } catch {
      await removeItem(REMEMBERED_KEY);
      setIsRemembered(false);
      setRememberedEmail(null);
      return null;
    }
  };

  const logout = () => {
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
