(function () {
  const endpoint = () => String(window.ALIGN_TEST_DB_URL || '').trim();

  const enhanceAllyPortal = () => {
    const path = String(window.location && window.location.pathname || '');
    if (!path.includes('demo-aliados')) return;

    const styleId = 'align-ally-premium-style';
    if (!document.getElementById(styleId)) {
      const link = document.createElement('link');
      link.id = styleId;
      link.rel = 'stylesheet';
      link.href = 'portal-aliados-premium.css?v=20260831-1';
      document.head.appendChild(link);
    }

    const applyEnhancements = () => {
      document.body.classList.add('align-ally-premium');

      const emptyLogo = document.querySelector('.empty-mark .align-primary-logo');
      if (emptyLogo) {
        emptyLogo.src = 'assets/align-welcome-official.svg?v=20260831-1';
        emptyLogo.alt = 'ALIGN';
        emptyLogo.classList.add('align-official-lockup');
      }

      const wordmark = document.querySelector('.align-wordmark-logo');
      if (wordmark) {
        wordmark.alt = 'ALIGN';
        wordmark.setAttribute('loading', 'eager');
        wordmark.setAttribute('decoding', 'async');
      }

      try {
        const businessSelect = document.querySelector('#business');
        if (businessSelect && !businessSelect.querySelector('option[value="ancla"]')) {
          const option = document.createElement('option');
          option.value = 'ancla';
          option.textContent = 'El Ancla del Canelo';
          businessSelect.appendChild(option);
        }

        if (typeof OFFERS !== 'undefined' && !OFFERS.ancla) {
          OFFERS.ancla = {
            id: 'ALI-012',
            name: 'El Ancla del Canelo',
            category: 'Food & Experiences',
            plans: ['brotherhood', 'duo', 'circle'],
            promotions: [
              {
                label: '20% OFF · Party Boat',
                benefit: '20% de descuento en Party Boat',
                rules: 'Aplica a la reservación del Party Boat para grupos de 12 a 20 personas. Sujeto a disponibilidad y reservación previa.',
                discount: .20
              },
              {
                label: '15% OFF · Comida +$500',
                benefit: '15% de descuento en consumo de comida',
                rules: 'Aplica únicamente cuando el consumo de comida sea mayor a $500 MXN. No aplica en cuentas de $500 o menos.',
                get discount() {
                  const gross = Number(document.getElementById('grossTicket')?.value || 0);
                  return gross > 500 ? .15 : 0;
                }
              }
            ]
          };
        }
      } catch (error) {
        console.warn('ALIGN ally portal enhancement:', error);
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', applyEnhancements, { once: true });
    } else {
      applyEnhancements();
    }
  };

  enhanceAllyPortal();

  const DEMO_PASSWORD_HASH = '9eaccd2c583494f7983e82bedb544bfd29fca0955c42020c4b04ecc0b9058076';
  const DEMO_ACCOUNTS = {
    cordex2002: {
      socioId: 'SOC-GH-MSSFQ14W',
      username: 'cordex2002',
      name: 'Cordex',
      planName: 'The Brotherhood',
      memberCode: 'AL-BRO-8E495E',
      token: 'ALIGN-DEMO-8E495E-MSSFQ14W'
    },
    cordex02: {
      socioId: 'SOC-GH-MSSFYMEC',
      username: 'cordex02',
      name: 'Cordex',
      planName: 'The Brotherhood',
      memberCode: 'AL-BRO-C7817E',
      token: 'ALIGN-DEMO-C7817E-MSSFYMEC'
    },
    cordex: {
      socioId: 'SOC-GH-MSSG74CG',
      username: 'cordex',
      name: 'Cordero Edgar',
      planName: 'The Brotherhood',
      memberCode: 'AL-BRO-2883E2',
      token: 'ALIGN-DEMO-2883E2-MSSG74CG'
    },
    tikis: {
      socioId: 'SOC-GH-MSSJ7ZZM',
      username: 'tikis',
      name: 'Edgar Cordero',
      planName: 'The Brotherhood',
      memberCode: 'AL-BRO-EEEFD7',
      token: 'ALIGN-DEMO-EEEFD7-MSSJ7ZZM'
    }
  };

  const readLocalGroup = () => {
    try { return JSON.parse(localStorage.getItem('align_demo_group') || 'null'); }
    catch (_) { return null; }
  };

  const postWrite = async payload => {
    const url = endpoint();
    if (!url) return { ok: false, pendingSetup: true };
    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        cache: 'no-store',
        keepalive: true,
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, mode: 'ALIGN_TEST_2026' })
      });
      return { ok: true };
    } catch (error) {
      console.warn('ALIGN test database:', error);
      return { ok: false, error: error.message };
    }
  };

  const postRead = async payload => {
    const url = endpoint();
    if (!url) return { ok: false, pendingSetup: true };
    try {
      const response = await fetch(url, {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        redirect: 'follow',
        headers: { 'content-type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ ...payload, mode: 'ALIGN_TEST_2026' })
      });
      const data = await response.json();
      return data && typeof data === 'object' ? data : { ok: false, error: 'Respuesta inválida.' };
    } catch (error) {
      console.warn('ALIGN test database read:', error);
      return { ok: false, networkError: true, error: error.message };
    }
  };

  const demoLogin = (username, passwordHash) => {
    const key = String(username || '').trim().toLowerCase();
    const account = DEMO_ACCOUNTS[key];
    if (!account || String(passwordHash || '').toLowerCase() !== DEMO_PASSWORD_HASH) {
      return { ok: false, error: 'Usuario o contraseña incorrectos.' };
    }
    return {
      ok: true,
      socioId: account.socioId,
      username: account.username,
      name: account.name,
      planName: account.planName,
      status: 'Activo',
      demoFallback: true,
      cards: [{
        integranteId: account.socioId + '-P1',
        name: account.name,
        email: '',
        phone: '',
        level: account.planName,
        memberCode: account.memberCode,
        position: 1,
        status: 'Activa',
        token: account.token,
        groupId: account.socioId,
        photoUrl: '',
        savings: 0
      }]
    };
  };

  const enrichPayment = data => {
    const group = readLocalGroup();
    if (!group || !group.account || String(group.socioId || '') !== String(data.socioId || '')) return data;
    const localCards = Array.isArray(group.cards) ? group.cards : [];
    return {
      ...data,
      passwordHash: group.account.passwordHash || '',
      members: (Array.isArray(data.members) ? data.members : []).map(member => {
        const local = localCards.find(card => String(card.memberCode || '') === String(member.memberCode || ''));
        return { ...member, token: local && local.token ? local.token : '' };
      })
    };
  };

  const login = async (username, passwordHash) => {
    const remote = await postRead({ action: 'login', username, passwordHash });
    const message = String(remote && remote.error || '').toLowerCase();
    const endpointIsOld = message.includes('acción no reconocida') || message.includes('accion no reconocida');
    if (endpointIsOld || (remote && remote.pendingSetup)) {
      return demoLogin(username, passwordHash);
    }
    return remote;
  };

  window.ALIGN_TEST_DB = {
    enabled: () => Boolean(endpoint()),
    registerPayment: data => postWrite({ action: 'register_payment', ...enrichPayment(data) }),
    recordVisit: data => postWrite({ action: 'register_visit', ...data }),
    login,
    syncAccount: group => postRead({
      action: 'sync_account',
      socioId: group && group.socioId,
      username: group && group.account && group.account.username,
      passwordHash: group && group.account && group.account.passwordHash,
      members: Array.isArray(group && group.cards) ? group.cards.map(card => ({ memberCode: card.memberCode, token: card.token })) : []
    })
  };
})();
