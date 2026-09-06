let nativeNavigationRef: { navigate: (name: string, params?: Record<string, unknown>) => void; goBack: () => void } | null = null;

export function setNativeNavigationRef(ref: typeof nativeNavigationRef): void {
  nativeNavigationRef = ref;
}

export function nativeNavigate(route: string, params?: Record<string, unknown>): void {
  if (nativeNavigationRef) {
    nativeNavigationRef.navigate(route, params);
  }
}

export function nativeGoBack(): void {
  if (nativeNavigationRef) {
    nativeNavigationRef.goBack();
  }
}
