export interface Toast {
	id: string;
	message: string;
	type: 'success' | 'error' | 'warning' | 'info';
	duration?: number;
}

const MAX_TOASTS = 5;
let toasts = $state<Toast[]>([]);

export function getToasts(): Toast[] {
	return toasts;
}

export function addToast(
	message: string,
	type: Toast['type'] = 'info',
	duration = 5000
): void {
	const id = crypto.randomUUID();
	const toast: Toast = { id, message, type, duration };

	// Remove oldest if at capacity
	if (toasts.length >= MAX_TOASTS) {
		toasts = toasts.slice(1);
	}

	toasts = [...toasts, toast];

	if (duration > 0) {
		setTimeout(() => removeToast(id), duration);
	}
}

export function removeToast(id: string): void {
	toasts = toasts.filter((t) => t.id !== id);
}
