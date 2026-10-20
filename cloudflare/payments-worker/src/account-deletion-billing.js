/**
 * Stripe cancellation preflight for account erasure.
 * Read and validate ALL subscriptions before sending a single destructive
 * cancellation request. This module has no Live enablement or HTTP route.
 */
const SUBSCRIPTION = /^sub_[A-Za-z0-9_]+$/;
const CUSTOMER = /^cus_[A-Za-z0-9]+$/;
const STOPPED = new Set(["canceled", "incomplete_expired"]);

export async function stopVerifiedSubscriptions(env, subscriptionIds, expectedCustomerId, stripeRequest) {
  if (!Array.isArray(subscriptionIds) || !Array.isArray([...subscriptionIds])) {
    throw new Error("No se pudo verificar el listado de suscripciones.");
  }
  const ids = [...new Set(subscriptionIds)];
  if (ids.length > 25 || ids.some(id => typeof id !== "string" || !SUBSCRIPTION.test(id))) {
    throw new Error("Las suscripciones requieren revisión asistida.");
  }
  if (ids.length && (typeof expectedCustomerId !== "string" || !CUSTOMER.test(expectedCustomerId))) {
    throw new Error("No se puede cancelar una suscripción sin verificar al cliente de Stripe.");
  }
  const pending = [];
  // Deliberately sequential and read-only during the ownership preflight.
  for (const id of ids) {
    const current = await stripeRequest(env, "GET", "subscriptions/" + encodeURIComponent(id));
    const customer = typeof current?.customer === "string" ? current.customer : current?.customer?.id;
    if (current?.id !== id || customer !== expectedCustomerId ||
        typeof current.status !== "string" || !current.status) {
      throw new Error("La suscripción no corresponde al cliente autenticado.");
    }
    if (!STOPPED.has(current.status)) pending.push(id);
  }
  // Do not enter this stage if any customer/ID lookup failed.
  let canceled = 0;
  for (const id of pending) {
    const result = await stripeRequest(env, "DELETE",
      "subscriptions/" + encodeURIComponent(id), {prorate:"false"});
    if (result?.id !== id || result?.status !== "canceled") {
      throw new Error("Stripe no confirmó la cancelación de la suscripción.");
    }
    canceled += 1;
  }
  return {inspected: ids.length, canceled};
}
