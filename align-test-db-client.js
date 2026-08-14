(function () {
  const endpoint = () => String(window.ALIGN_TEST_DB_URL || '').trim();

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

  window.ALIGN_TEST_DB = {
    enabled: () => Boolean(endpoint()),
    registerPayment: data => postWrite({ action: 'register_payment', ...enrichPayment(data) }),
    recordVisit: data => postWrite({ action: 'register_visit', ...data }),
    login: (username, passwordHash) => postRead({ action: 'login', username, passwordHash }),
    syncAccount: group => postRead({
      action: 'sync_account',
      socioId: group && group.socioId,
      username: group && group.account && group.account.username,
      passwordHash: group && group.account && group.account.passwordHash,
      members: Array.isArray(group && group.cards) ? group.cards.map(card => ({ memberCode: card.memberCode, token: card.token })) : []
    })
  };
})();
