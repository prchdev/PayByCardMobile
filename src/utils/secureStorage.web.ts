export async function getItem(key: string): Promise<string | null> {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    localStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}

export async function getSessionItem(key: string): Promise<string | null> {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export async function setSessionItem(key: string, value: string): Promise<void> {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* no-op */
  }
}

export async function removeSessionItem(key: string): Promise<void> {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* no-op */
  }
}
