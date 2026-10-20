import { authenticatePreviewPassword, validPlaintextPassword, previewPasswordV2Enabled } from "./member-password-v2.js";
import { checkAccountReporting, eraseAccountReporting } from "./account-deletion-reporting.js";
import { stopVerifiedSubscriptions } from "./account-deletion-billing.js";

// Isolated account-erasure workflow. Requires a valid member session, password
// re-authentication and a second explicit phrase. No Stripe keys on the device.
// Disabled in Production until the isolated Preview contract is verified.

const MAX_KEYS = 3000;

function clean(value, max = 120) {
  return String(value ?? "").trim().slice(0, max);
}

function reply(body, status, origin) {
  const allowed = new Set([
    "https://alignmembers.com.mx",
    "https://www.alignmembers.com.mx",
    "https://edgartikis.github.io",
  ]);
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "access-control-allow-origin": allowed.has(origin) ? origin : "https://alignmembers.com.mx",
      "access-control-allow-methods": "POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
      vary: "Origin",
    },
  });
}

function equalFixed(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function verifyPassword(account, plaintext, env) {
  if (!validPlaintextPassword(plaintext)) return false;
  if (Object.hasOwn(account, "passwordVerifier")) {
    if (!previewPasswordV2Enabled(env)) return false;
    return (await authenticatePreviewPassword(account, plaintext)).ok;
  }
  if (!/^[a-f0-9]{64}$/.test(String(account.passwordHash || ""))) return false;
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(plaintext));
  const digest = Array.from(new Uint8Array(raw), (b) => b.toString(16).padStart(2, "0")).join("");
  return equalFixed(digest, account.passwordHash);
}

async function keysWithPrefix(env, prefix) {
  const result = [];
  let cursor;
  do {
    const batch = await env.PAYMENT_STATE.list({ prefix, cursor, limit: 100 });
    for (const key of batch.keys || []) {
      result.push(key.name);
      if (result.length > MAX_KEYS) throw new Error("La cuenta requiere eliminación asistida. Contacta a soporte.");
    }
    cursor = batch.list_complete ? undefined : batch.cursor;
  } while (cursor);
  return result;
}

async function fromKey(env, key) {
  const raw = await env.PAYMENT_STATE.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function isOwner(group, account) {
  return group?.membershipType === "owner_lifetime" ||
    group?.ownerComplimentary === true || account.primaryToken === "OWNER-EDGAR-1";
}

// Preflight ALL related KV collections before cancelling payments or changing membership.
// This prevents silently skipping some records when KV collections grow large.
async function deletionPlan(env, account, group) {
  const tokenSet = new Set([...(group.tokens || []), ...(account.tokens || []), account.primaryToken]);
  const tokens = [...tokenSet].filter((t) => /^[A-Za-z0-9_-]{20,}$/.test(t));
  if (!tokens.length) throw new Error("No se pudo comprobar la titularidad de las tarjetas.");

  const [subscriptions, activations, memberSessions, visits, intents, drafts, sessionMappings, alternateMappings] =
    await Promise.all([
      keysWithPrefix(env, "subscription:"),
      keysWithPrefix(env, "activation:"),
      keysWithPrefix(env, "member-session:"),
      keysWithPrefix(env, "visit:"),
      keysWithPrefix(env, "benefit-intent:"),
      keysWithPrefix(env, "draft:"),
      keysWithPrefix(env, "session:"),
      keysWithPrefix(env, "sessions:"),
    ]);
  const deletions = new Set([
    `account:${account.username}`,
    `group:${account.groupId}`,
    `legal-consent:${account.groupId}`,
    ...tokens.map((t) => `member:${t}`),
    ...(isOwner(group, account) ? ["owner-lifetime:primary", "wallet:member:AL-FOUNDER-001"] : []),
  ]);
  const subIds = new Set();
  const customerIds = new Set();
  for (const customerId of [group.customerId, account.customerId]) {
    if (typeof customerId === "string" && /^cus_[A-Za-z0-9]+$/.test(customerId)) customerIds.add(customerId);
  }
  for (const id of [group.subscriptionId, ...(group.subscriptionIds || [])]) {
    if (typeof id === "string" && /^sub_[A-Za-z0-9_]+$/.test(id)) subIds.add(id);
  }
  for (const key of subscriptions) {
    if (clean(await env.PAYMENT_STATE.get(key), 140) === account.groupId) {
      deletions.add(key);
      subIds.add(key.slice("subscription:".length));
    }
  }
  const linkedDrafts = new Set();
  const linkedSessions = new Set();
  for (const key of activations) {
    const activation = await fromKey(env, key);
    if (activation?.groupId !== account.groupId) continue;
    deletions.add(key);
    if (typeof activation.subscriptionId === "string" && /^sub_/.test(activation.subscriptionId)) subIds.add(activation.subscriptionId);
    if (typeof activation.customerId === "string" && /^cus_[A-Za-z0-9]+$/.test(activation.customerId)) {
      customerIds.add(activation.customerId);
    }
    if (activation.sessionId) linkedSessions.add(String(activation.sessionId));
  }
  for (const key of memberSessions) {
    if ((await fromKey(env, key))?.groupId === account.groupId) deletions.add(key);
  }
  const redactions = [];
  const knownIdentifiers = new Set();
  for (const token of tokens) {
    const member = await fromKey(env, `member:${token}`);
    if (!member || member.groupId !== account.groupId) throw new Error("Una tarjeta no corresponde a la cuenta.");
    if (member.memberCode) knownIdentifiers.add(String(member.memberCode));
    if (member.integranteId) knownIdentifiers.add(String(member.integranteId));
    if (member.socioId) knownIdentifiers.add(String(member.socioId));
  }
  for (const key of visits) {
    const v = await fromKey(env, key);
    if (v && [v.memberCode, v.integranteId, v.socioId].some((id) => id && knownIdentifiers.has(String(id)))) {
      redactions.push({ key, record: v });
    }
  }
  for (const key of intents) {
    const value = await fromKey(env, key);
    if (value && (tokens.includes(value.memberToken) || tokens.includes(value.token))) deletions.add(key);
  }
  for (const token of tokens) {
    for (const key of await keysWithPrefix(env, `benefit-intent-latest:${token}:`)) deletions.add(key);
  }
  for (const key of drafts) {
    const draft = await fromKey(env, key);
    if (draft?.groupId === account.groupId) {
      linkedDrafts.add(key.slice("draft:".length));
    }
  }
  for (const key of [...sessionMappings, ...alternateMappings]) {
    const sid = key.slice(key.indexOf(":") + 1);
    if (linkedSessions.has(sid)) {
      deletions.add(key);
      const id = clean(await env.PAYMENT_STATE.get(key), 180);
      if (id) linkedDrafts.add(id);
    }
  }
  // Purge post-payment retry data and visit-client lookup indexes that still
  // point to the erased group. Do not touch records belonging to other groups.
  for (const subId of subIds) {
    deletions.add(`pending:invoice-paid:${subId}`);
  }
  const ownVisitIds = new Set(redactions.map(({ record }) => clean(record.visitId, 120)).filter(Boolean));
  if (ownVisitIds.size) {
    for (const key of await keysWithPrefix(env, "visit-client:")) {
      if (ownVisitIds.has(clean(await env.PAYMENT_STATE.get(key), 120))) deletions.add(key);
    }
  }
  for (const id of linkedDrafts) deletions.add(`draft:${id}`);
  return { deletions: [...deletions], redactions, subIds: [...subIds], customerIds: [...customerIds], tokens };
}

// A short bounded retry handles transient Cloudflare KV errors during cleanup.
// This is not a substitute for a separately authenticated manual recovery tool.
async function removeKvWithRetry(env, key) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { await env.PAYMENT_STATE.delete(key); return; }
    catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
    }
  }
  throw lastError;
}

// The recovery manifest holds only keys generated by the trusted preflight
// plan (including opaque member tokens), never raw member data or passwords.
// It expires after seven days and is removed on successful completion.
const RECOVERY_TTL_SECONDS = 7 * 24 * 60 * 60;

async function finalizeKvErasure(env, manifest) {
  const { groupId, tokens, redactionKeys, deletions } = manifest;
  const tombstone = `deleted-group:${groupId}`;
  const progressKey = `deletion-progress:${groupId}`;
  const attemptKey = `delete-attempts:${groupId}`;
  const manifestKey = `deletion-manifest:${groupId}`;
  for (const token of tokens) {
    const member = await fromKey(env, `member:${token}`);
    if (member && member.groupId !== groupId) {
      throw new Error("La tarjeta cambió de titular durante la eliminación.");
    }
    if (member) await env.PAYMENT_STATE.put(`member:${token}`, JSON.stringify({
      ...member, status: "Cancelada", validUntil: new Date(0).toISOString(),
    }));
  }
  for (const key of redactionKeys) {
    const record = await fromKey(env, key);
    if (!record) continue;
    // Explicit allowlist: never carry over arbitrary free-text, contact data,
    // tokens, photos or future profile fields into the retained visit history.
    // A deleted visit must never be replayed to Sheets by sync retries.
    const retained = {
      visitId: clean(record.visitId, 120),
      createdAt: clean(record.createdAt, 48),
      visitorName: "Cuenta eliminada",
      memberCode: "", integranteId: "", socioId: "",
      planName: clean(record.planName, 60),
      planKey: clean(record.planKey, 30),
      allyId: clean(record.allyId, 80),
      place: clean(record.place, 100),
      category: clean(record.category, 60),
      people: Number.isFinite(Number(record.people)) ? Number(record.people) : 0,
      gross: Number.isFinite(Number(record.gross)) ? Number(record.gross) : 0,
      spent: Number.isFinite(Number(record.spent)) ? Number(record.spent) : 0,
      saved: Number.isFinite(Number(record.saved)) ? Number(record.saved) : 0,
      dbSynced: true,
    };
    await env.PAYMENT_STATE.put(key, JSON.stringify(retained));
  }
  for (const key of deletions) await removeKvWithRetry(env, key);
  await removeKvWithRetry(env, attemptKey);
  await env.PAYMENT_STATE.put(tombstone, JSON.stringify({
    status: "complete", completedAt: new Date().toISOString(),
  }));
  // All personal KV keys are now gone. GC failures after this point must not
  // return an error claiming that the user's deletion failed.
  for (const key of [manifestKey, progressKey]) {
    try { await removeKvWithRetry(env, key); }
    catch { console.error("ALIGN deletion housekeeping cleanup delayed"); }
  }
}

function validRecoveryManifest(manifest, username, groupId) {
  if (!manifest || manifest.username !== username || manifest.groupId !== groupId ||
      !Array.isArray(manifest.tokens) || !Array.isArray(manifest.deletions) ||
      !Array.isArray(manifest.redactionKeys) ||
      manifest.tokens.length > MAX_KEYS || manifest.deletions.length > MAX_KEYS ||
      manifest.redactionKeys.length > MAX_KEYS) return false;
  if (!manifest.deletions.includes(`account:${username}`) ||
      !manifest.deletions.includes(`group:${groupId}`)) return false;
  if (!manifest.tokens.every(token => /^[A-Za-z0-9_-]{20,128}$/.test(token))) return false;
  if (!manifest.redactionKeys.every(key => /^visit:[A-Za-z0-9:_-]{1,160}$/.test(key))) return false;
  const allowed = /^(?:account|group|legal-consent|member|subscription|activation|member-session|benefit-intent|benefit-intent-latest|pending:invoice-paid|visit-client|draft|session|sessions):/;
  return manifest.deletions.every(key =>
    typeof key === "string" && key.length <= 250 && allowed.test(key));
}

/**
 * Deliberately NOT an HTTP route. Support-only recovery of an interrupted
 * Preview deletion after an already-authorized Stripe + Sheets erasure.
 * Call only from a trusted internal maintenance context, never from a member
 * request, and never in Live/Founder mode.
 */
export async function recoverInterruptedDeletionPreview(env, {username, groupId}) {
  const isolatedPreview = env.STRIPE_MODE === "test" &&
    env.MEMBER_ACCOUNT_DELETION_ENABLED === "true" &&
    env.MEMBER_PASSWORD_V2 === "true" &&
    env.MEMBER_LOGIN_GUARD === "true" &&
    env.ALIGN_APP_QR_ROTATION_ENABLED === "true" &&
    env.MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED !== "true";
  if (!isolatedPreview || username !== env.MEMBER_ACCOUNT_DELETION_TEST_USERNAME ||
      !/^[a-z0-9._-]{4,24}$/.test(username) ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(groupId)) {
    throw new Error("La recuperación no está autorizada fuera de la cuenta QA en Preview.");
  }
  const progress = await fromKey(env, `deletion-progress:${groupId}`);
  const tombstone = await fromKey(env, `deleted-group:${groupId}`);
  if (progress?.stage !== "purging-kv" || tombstone?.status !== "processing") {
    throw new Error("No hay una eliminación KV interrumpida que pueda recuperarse.");
  }
  const manifest = await fromKey(env, `deletion-manifest:${groupId}`);
  if (!validRecoveryManifest(manifest, username, groupId)) {
    throw new Error("Falta el manifiesto verificado; requiere recuperación asistida.");
  }
  await finalizeKvErasure(env, manifest);
  return {ok:true,status:"deleted"};
}

export async function handleMemberAccountDeletion(request, env, deps) {
  const origin = request.headers.get("origin") || "";
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": origin || "https://alignmembers.com.mx",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  } });
  if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405, origin);
  // Two independent, off-by-default deployment modes:
  // Preview = isolated Stripe Test / fake account allowlist.
  // Live = explicit deletion + live approval + reporting + login throttling.
  // A deploy of this code alone cannot enable destructive operations.
  const isolatedPreview = env.STRIPE_MODE === "test" &&
    env.MEMBER_PASSWORD_V2 === "true" &&
    env.MEMBER_LOGIN_GUARD === "true" &&
    env.ALIGN_APP_QR_ROTATION_ENABLED === "true";
  const reviewedLive = env.STRIPE_MODE === "live" &&
    env.MEMBER_ACCOUNT_DELETION_LIVE_ENABLED === "true" &&
    env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED === "true" &&
    env.MEMBER_LOGIN_GUARD === "true";
  if (env.MEMBER_ACCOUNT_DELETION_ENABLED !== "true" || !(isolatedPreview || reviewedLive)) {
    return reply({ error: "La eliminación de cuenta aún no está habilitada en este entorno." }, 503, origin);
  }
  const permittedUsername = clean(env.MEMBER_ACCOUNT_DELETION_TEST_USERNAME, 24).toLowerCase();
  if (isolatedPreview && !/^[a-z0-9._-]{4,24}$/.test(permittedUsername)) {
    return reply({ error: "Falta configurar la cuenta ficticia autorizada para eliminación." }, 503, origin);
  }
  if (!env.PAYMENT_STATE) return reply({ error: "Servicio no disponible." }, 503, origin);

  let session;
  try { session = await deps.requireMemberSession(request, env); }
  catch { return reply({ error: "La sesión expiró. Vuelve a iniciar sesión." }, 401, origin); }

  const body = await request.json().catch(() => ({}));
  if (body.confirmation !== "ELIMINAR" || !validPlaintextPassword(body.password)) {
    return reply({ error: "Escribe ELIMINAR y confirma tu contraseña." }, 400, origin);
  }
  if (isolatedPreview && session.username !== permittedUsername) {
    return reply({ error: "Solo se permite eliminar la cuenta ficticia autorizada para esta prueba." }, 403, origin);
  }
  const account = await deps.readJson(env, `account:${session.username}`);
  if (!account || account.username !== session.username || account.groupId !== session.groupId ||
      account.primaryToken !== session.primaryToken) {
    return reply({ error: "La sesión no corresponde a esta cuenta. Inicia sesión nuevamente." }, 403, origin);
  }
  const group = await deps.readJson(env, `group:${account.groupId}`);
  if (!group || await env.PAYMENT_STATE.get(`deleted-group:${account.groupId}`)) {
    return reply({ error: "La cuenta ya fue desactivada." }, 410, origin);
  }
  if (isOwner(group, account)) {
    // Revoking this marker disables the independently provisioned permanent
    // Founder Wallet pass. Never grant deletion based only on an arbitrary
    // memberCode or a request body boolean.
    const marker = await deps.readJson(env, "owner-lifetime:primary");
    const ownerCard = await deps.readJson(env, `member:${account.primaryToken}`);
    const validFounder = account.username === "edgar.cordero" &&
      group.membershipType === "owner_lifetime" &&
      group.ownerComplimentary === true &&
      marker?.groupId === account.groupId &&
      marker?.username === account.username &&
      marker?.memberCode === "AL-FOUNDER-001" &&
      ownerCard?.groupId === account.groupId &&
      ownerCard?.token === account.primaryToken &&
      ownerCard?.memberCode === "AL-FOUNDER-001" &&
      ownerCard?.membershipType === "owner_lifetime" &&
      ownerCard?.ownerComplimentary === true;
    if (env.MEMBER_ACCOUNT_DELETION_FOUNDER_ENABLED !== "true" || !validFounder) {
      return reply({ error: "La eliminación de Founder Lifetime requiere una validación especial que aún no está habilitada." }, 403, origin);
    }
  }

  // Per-account rate limit for destructive reauthentication; no password logs.
  const attemptKey = `delete-attempts:${account.groupId}`;
  const tries = Math.max(0, Number(await env.PAYMENT_STATE.get(attemptKey)) || 0);
  if (tries >= 5) return reply({ error: "Demasiados intentos. Inténtalo dentro de 15 minutos." }, 429, origin);
  if (!await verifyPassword(account, body.password, env)) {
    await env.PAYMENT_STATE.put(attemptKey, String(tries + 1), { expirationTtl: 900 });
    return reply({ error: "Contraseña incorrecta." }, 401, origin);
  }

  try {
    const plan = await deletionPlan(env, account, group);
    // The journal contains only status and timestamps, never credentials.
    // It enables operational diagnosis if Stripe/Sheets/KV temporarily fails.
    // Repeating an authenticated request before the tombstone is written is
    // intentionally idempotent (Stripe GET then conditional DELETE; Sheets
    // response uses the same identity), without replaying another charge.
    const progressKey = `deletion-progress:${account.groupId}`;
    const setProgress = (stage) => env.PAYMENT_STATE.put(progressKey,
      JSON.stringify({stage, updatedAt:new Date().toISOString()}));
    // Resolve one Stripe identity. Live cannot skip reporting or ownership
    // verification; its Google Apps Script must affirm capability + ownership
    // BEFORE we attempt the first Stripe cancellation.
    const expectedCustomerId = plan.customerIds.length === 1 ? plan.customerIds[0] : null;
    if (plan.customerIds.length > 1 ||
        (plan.subIds.length && !expectedCustomerId) ||
        (env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED === "true" && !expectedCustomerId)) {
      throw new Error("No se pudo identificar inequívocamente al titular en Stripe y los reportes.");
    }
    if (reviewedLive) {
      await setProgress("validating-reporting");
      await checkAccountReporting(env, {
        username: account.username, customerId: expectedCustomerId,
      }, deps.reportingFetch);
    }
    await setProgress("stopping-renewals");
    // Validate ownership of ALL subscriptions before stopping ANY of them.
    await stopVerifiedSubscriptions(env, plan.subIds, expectedCustomerId, deps.stripeRequest);
    await setProgress("erasing-reporting");
    // An external reporting failure MUST NOT result in a successful deletion
    // response or erased KV records. After Stripe cancellation, retrying the
    // request is safe: the subscription is already canceled.
    if (env.MEMBER_ACCOUNT_DELETION_REPORTING_ENABLED === "true") {
      if (plan.customerIds.length !== 1) {
        throw new Error("No se pudo identificar inequívocamente al titular en los reportes.");
      }
      await eraseAccountReporting(env, {
        username: account.username,
        customerId: plan.customerIds[0],
      }, deps.reportingFetch);
    }
    await setProgress("purging-kv");
    // Save a bounded manifest before the first destructive KV operation.
    // The manifest enables support to complete a stuck "processing" tombstone
    // without re-authenticating a session that is correctly blocked.
    const manifest = {
      username: account.username, groupId: account.groupId,
      tokens: plan.tokens, deletions: plan.deletions,
      redactionKeys: plan.redactions.map(({key}) => key),
      createdAt: new Date().toISOString(),
    };
    if (!validRecoveryManifest(manifest, account.username, account.groupId) &&
        !isOwner(group, account)) throw new Error("El manifiesto KV no es seguro.");
    await env.PAYMENT_STATE.put(`deletion-manifest:${account.groupId}`,
      JSON.stringify(manifest), {expirationTtl: RECOVERY_TTL_SECONDS});
    // Tombstone prevents old checkout activation data from resurrecting a
    // deleted group and makes sessions fail closed during KV cleanup.
    await env.PAYMENT_STATE.put(`deleted-group:${account.groupId}`, JSON.stringify({
      status: "processing", requestedAt: new Date().toISOString(),
    }));
    await finalizeKvErasure(env, manifest);
    return reply({ ok: true, status: "deleted",
      message: "Cuenta eliminada y renovación detenida. Los comprobantes fiscales se conservan cuando la ley lo exige." }, 200, origin);
  } catch (error) {
    // Never pretend the deletion succeeded when Stripe/KV work failed.
    console.error("ALIGN deletion operation failed", error?.name || "Error");
    return reply({ error: "No se pudo completar la eliminación de forma segura. Contacta a soporte." }, 503, origin);
  }
}
