import { describe, it, expect } from 'vitest';
import { grantsAppAccess, APP_ACCESS_STATUSES } from './billing';

describe('grantsAppAccess', () => {
  it('concede acceso en período de prueba', () => {
    expect(grantsAppAccess('trialing')).toBe(true);
  });

  it('concede acceso con suscripción activa', () => {
    expect(grantsAppAccess('active')).toBe(true);
  });

  // Regresión: courtesy (active sin stripe_subscription_id) es acceso válido.
  // Antes caía al paywall "Tu plan actual" porque no estaba en la lista blanca.
  it('concede acceso en cortesía (courtesy)', () => {
    expect(grantsAppAccess('courtesy')).toBe(true);
  });

  it('bloquea estados de pago inválido', () => {
    expect(grantsAppAccess('past_due')).toBe(false);
    expect(grantsAppAccess('canceled')).toBe(false);
    expect(grantsAppAccess('unpaid')).toBe(false);
  });

  it('bloquea estados desconocidos o ausentes', () => {
    expect(grantsAppAccess('whatever')).toBe(false);
    expect(grantsAppAccess(null)).toBe(false);
    expect(grantsAppAccess(undefined)).toBe(false);
  });

  it('expone courtesy entre los estados con acceso', () => {
    expect(APP_ACCESS_STATUSES).toContain('courtesy');
  });
});
