import { describe, expect, it } from 'vitest';
import { normaliseDeliveryStatus, parseWassengerStatusUpdate } from '../wassenger.provider.js';

describe('normaliseDeliveryStatus', () => {
  it('prefers the finer deliveryStatus over status', () => {
    expect(normaliseDeliveryStatus('processed', 'delivered')).toBe('delivered');
    expect(normaliseDeliveryStatus('processed', 'read')).toBe('read');
  });

  it('falls back to status when deliveryStatus is absent', () => {
    expect(normaliseDeliveryStatus('queued', null)).toBe('queued');
    expect(normaliseDeliveryStatus('processed', undefined)).toBe('sent');
    expect(normaliseDeliveryStatus('failed', undefined)).toBe('failed');
  });

  it('returns null for unknown values so a new Wassenger state cannot overwrite a known one', () => {
    expect(normaliseDeliveryStatus('weird', 'strange')).toBeNull();
    expect(normaliseDeliveryStatus(undefined, undefined)).toBeNull();
  });
});

describe('parseWassengerStatusUpdate', () => {
  it('extracts id and status from a message:update event', () => {
    expect(
      parseWassengerStatusUpdate({ event: 'message:update', data: { id: 'abc123', status: 'processed', deliveryStatus: 'delivered' } } as never)
    ).toEqual({ messageId: 'abc123', status: 'delivered' });
  });

  it('ignores incoming-message events and events without an id or a known status', () => {
    expect(parseWassengerStatusUpdate({ event: 'message:in:new', data: { id: 'x', status: 'queued' } } as never)).toBeNull();
    expect(parseWassengerStatusUpdate({ event: 'message:update', data: { status: 'queued' } } as never)).toBeNull();
    expect(parseWassengerStatusUpdate({ event: 'message:update', data: { id: 'x', status: 'weird' } } as never)).toBeNull();
  });
});
