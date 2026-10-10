(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AccountIsolation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function create(storage, keys) {
    const ownerKey = 'msp-active-account-v1';
    const cachePrefix = 'msp-account-recovery-v1:';
    let owner = storage.getItem(ownerKey) || 'unassigned';
    let revision = 0;
    function snapshot() {
      const values = {};
      for (const key of keys) { const value = storage.getItem(key); if (value !== null) values[key] = value; }
      return values;
    }
    function archive() {
      const values = snapshot();
      if (Object.keys(values).length) {
        const encoded = JSON.stringify({ owner, savedAt: new Date().toISOString(), values });
        const key = cachePrefix + encodeURIComponent(owner);
        storage.setItem(key, encoded);
        if (storage.getItem(key) !== encoded) throw new Error('Could not verify the local recovery snapshot.');
      }
    }
    function switchTo(userId) {
      const next = userId || 'signed-out';
      if (owner === next) return false;
      let restored = null;
      if (userId) {
        try {
          const parsed = JSON.parse(storage.getItem(cachePrefix + encodeURIComponent(next)) || 'null');
          if (parsed?.owner === next && parsed.values && typeof parsed.values === 'object') restored = parsed.values;
        } catch (_) { /* Damaged recovery data must not expose another account. */ }
      }
      // If storage is full, stop before clearing any recoverable financial data.
      archive();
      for (const key of keys) storage.removeItem(key);
      owner = next; revision++;
      storage.setItem(ownerKey, owner);
      if (restored) for (const key of keys) if (restored[key] != null) storage.setItem(key, restored[key]);
      return true;
    }
    return { switchTo, archive, owner: () => owner, token: () => revision, valid: token => token === revision, invalidate: () => ++revision };
  }
  return { create };
});
