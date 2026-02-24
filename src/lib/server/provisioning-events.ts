import type { PhaseEvent } from './provisioner';

export interface ProvisioningEvent {
	envId: string;
	event: PhaseEvent;
	timestamp: string;
}

type ProvisioningSubscriber = (event: ProvisioningEvent) => void;

const subscribers = new Set<ProvisioningSubscriber>();

export function broadcastProvisioningEvent(envId: string, event: PhaseEvent): void {
	const provEvent: ProvisioningEvent = {
		envId,
		event,
		timestamp: new Date().toISOString()
	};
	for (const sub of subscribers) {
		try {
			sub(provEvent);
		} catch {
			subscribers.delete(sub);
		}
	}
}

export function subscribeProvisioning(callback: ProvisioningSubscriber): () => void {
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
}
