export interface PasswordValidationResult {
  isValid: boolean;
  error?: string;
}

export function validatePassword(password: string): PasswordValidationResult {
  if (!password) {
    return { isValid: false, error: 'Password is required' };
  }

  if (password.length < 8) {
    return { isValid: false, error: 'Password must be at least 8 characters' };
  }

  if (password.length > 20) {
    return { isValid: false, error: 'Password must not exceed 20 characters' };
  }

  if (!/[A-Z]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least 1 capital letter' };
  }

  if (!/[0-9]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least 1 number' };
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    return { isValid: false, error: 'Password must contain at least 1 special symbol' };
  }

  return { isValid: true };
}

export const PASSWORD_REQUIREMENTS = [
  'At least 8 characters and maximum 20 characters',
  'At least 1 capital letter (A-Z)',
  'At least 1 number (0-9)',
  'At least 1 special symbol (!@#$%^&*)',
];
