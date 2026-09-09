export const PLANS = Object.freeze({
  brotherhood: { level: "The Brotherhood", name: "ALIGN The Brotherhood", amount: 24900, seats: 1, prefix: "BRO" },
  girls: { level: "Girls Club", name: "ALIGN Girls Club", amount: 24900, seats: 1, prefix: "GIR" },
  ranch: { level: "Ranch Club", name: "ALIGN Ranch Club", amount: 24900, seats: 1, prefix: "RAN" },
  duo: { level: "Duo Club", name: "ALIGN Duo Club", amount: 34900, seats: 2, prefix: "DUO" },
  circle: { level: "Private Circle", name: "ALIGN Private Circle", amount: 49900, seats: 3, prefix: "CIR" },
});

export const planFor = (key) => PLANS[String(key || "").trim().toLowerCase()] || null;

export const planFromSession = (session) => {
  const key = String(session.metadata?.align_membership || "").toLowerCase();
  const plan = planFor(key);
  if (!plan) throw new Error("Plan de membresía desconocido.");
  return { key, ...plan };
};

export const membersFromMetadata = (metadata, seats) => {
  const members = [];
  for (let index = 1; index <= seats; index += 1) {
    const name = String(metadata?.[`member_${index}_name`] || "").trim();
    const email = String(metadata?.[`member_${index}_email`] || "").trim().toLowerCase();
    const phone = String(metadata?.[`member_${index}_phone`] || "").replace(/[^0-9+]/g, "");
    if (!name || !email || !phone) throw new Error(`Faltan datos del integrante ${index}.`);
    members.push({ name, email, phone });
  }
  return members;
};
