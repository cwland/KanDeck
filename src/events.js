/**
 * Tiny app-wide event bus. Storage/API layers emit domain events
 * (card:created, card:moved, card:updated); the notification & webhook
 * services (Part 5) subscribe here. Keeps those concerns decoupled.
 */
import { EventEmitter } from 'node:events';

export const events = new EventEmitter();
events.setMaxListeners(50);

export default events;
