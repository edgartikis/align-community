export const PLANS = Object.freeze({
  brotherhood: { level: 'The Brotherhood', name: 'ALIGN The Brotherhood', founderAmount: 24900, regularAmount: 29900, seats: 1, prefix: 'BRO', founderEligible: true },
  girls: { level: 'Girls Club', name: 'ALIGN Girls Club', founderAmount: 24900, regularAmount: 29900, seats: 1, prefix: 'GIR', founderEligible: true },
  ranch: { level: 'Ranch Club', name: 'ALIGN Ranch Club', founderAmount: 24900, regularAmount: 29900, seats: 1, prefix: 'RAN', founderEligible: true },
  duo: { level: 'Duo Club', name: 'ALIGN Duo Club', founderAmount: 34900, regularAmount: 34900, seats: 2, prefix: 'DUO', founderEligible: false },
  circle: { level: 'Private Circle', name: 'ALIGN Private Circle', founderAmount: 49900, regularAmount: 49900, seats: 3, prefix: 'CIR', founderEligible: false },
});

export const planFor = key => PLANS[String(key || '').trim().toLowerCase()] || null;
