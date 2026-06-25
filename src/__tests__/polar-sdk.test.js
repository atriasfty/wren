import { describe, it, expect } from 'vitest';
import { Polar } from '@polar-sh/sdk';

describe('Polar SDK Structure', () => {
  it('should expose the expected root namespaces', () => {
    const polar = new Polar({ accessToken: 'test' });
    
    expect(polar.checkouts).toBeDefined();
    expect(polar.customerSessions).toBeDefined();
    expect(polar.subscriptions).toBeDefined();
  });

  it('should have a create method on checkouts', () => {
    const polar = new Polar({ accessToken: 'test' });
    expect(typeof polar.checkouts.create).toBe('function');
  });

  it('should have a create method on customerSessions', () => {
    const polar = new Polar({ accessToken: 'test' });
    expect(typeof polar.customerSessions.create).toBe('function');
  });

  it('should have an update method on subscriptions', () => {
    const polar = new Polar({ accessToken: 'test' });
    expect(typeof polar.subscriptions.update).toBe('function');
  });
});
