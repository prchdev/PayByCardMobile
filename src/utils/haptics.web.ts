export async function impact(_style: 'light' | 'medium' | 'heavy' = 'light'): Promise<void> {}

export async function notification(_type: 'success' | 'warning' | 'error' = 'success'): Promise<void> {}

export async function selection(): Promise<void> {}
