export function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes('network request failed') ||
      msg.includes('networkerror') ||
      msg.includes('failed to fetch') ||
      msg.includes('network error') ||
      msg.includes('timeout') ||
      msg.includes('aborted')
    ) {
      return 'No internet connection. Please check your network and try again.';
    }
    return err.message;
  }
  return fallback;
}
