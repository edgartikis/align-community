(function () {
  const endpoint = () => String(window.ALIGN_TEST_DB_URL || '').trim();
  const post = async payload => {
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

  window.ALIGN_TEST_DB = {
    enabled: () => Boolean(endpoint()),
    registerPayment: data => post({ action: 'register_payment', ...data }),
    recordVisit: data => post({ action: 'register_visit', ...data })
  };
})();
