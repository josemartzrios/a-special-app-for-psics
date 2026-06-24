/**
 * Estados de suscripción que conceden acceso a la app del psicólogo.
 *
 * `courtesy` = acceso de cortesía manual: suscripción `active` en la DB pero sin
 * `stripe_subscription_id`. El backend lo reporta como `"courtesy"`
 * (ver `_build_billing_status` en `backend/api/billing.py`). Es acceso VÁLIDO,
 * igual que `trialing`/`active`; omitirlo aquí manda al usuario al paywall.
 */
export const APP_ACCESS_STATUSES = ['trialing', 'active', 'courtesy'];

/**
 * Decide si un estado de billing concede acceso a la app (vs. enviar al paywall).
 * @param {string|null|undefined} status — `billing.status` de `/billing/status`
 * @returns {boolean}
 */
export function grantsAppAccess(status) {
  return APP_ACCESS_STATUSES.includes(status);
}
