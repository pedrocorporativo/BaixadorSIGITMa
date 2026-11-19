(function (root) {
  "use strict";

  function normalize(items) {
    return (Array.isArray(items) ? items : []).filter(item =>
      item && Number.isInteger(item.tabId) && item.tabId >= 0 && typeof item.url === "string"
    ).map(item => ({
      tabId: item.tabId,
      url: item.url,
      title: String(item.title || "Chamado SIGITM"),
      mode: item.mode === "automatic" ? "automatic" : "analysis",
      downloadMode: item.downloadMode === "queue" ? "queue" : "single",
      queuedAt: String(item.queuedAt || new Date().toISOString()),
      requestId: String(item.requestId || "")
    }));
  }

  function enqueue(items, item) {
    const queue = normalize(items);
    const existingIndex = queue.findIndex(entry => entry.tabId === item.tabId);
    if (existingIndex >= 0) return { queue, added: false, position: existingIndex + 1 };
    queue.push({
      tabId: item.tabId,
      url: String(item.url || ""),
      title: String(item.title || "Chamado SIGITM"),
      mode: item.mode === "automatic" ? "automatic" : "analysis",
      downloadMode: item.downloadMode === "queue" ? "queue" : "single",
      queuedAt: String(item.queuedAt || new Date().toISOString()),
      requestId: String(item.requestId || "")
    });
    return { queue, added: true, position: queue.length };
  }

  function dequeue(items) {
    const queue = normalize(items);
    return { item: queue[0] || null, queue: queue.slice(1) };
  }

  function removeTab(items, tabId) {
    return normalize(items).filter(item => item.tabId !== tabId);
  }

  function hasCapacity(activeCount, limit = 2) {
    return Number.isInteger(activeCount) && activeCount >= 0 && Number.isInteger(limit) && limit > 0 && activeCount < limit;
  }

  function nextStartable(items, activeTabIds, activeCount, limit = 2) {
    if (!hasCapacity(activeCount, limit)) return null;
    const activeTabs = activeTabIds instanceof Set ? activeTabIds : new Set(activeTabIds || []);
    return normalize(items).find(item => !activeTabs.has(item.tabId)) || null;
  }

  const api = { normalize, enqueue, dequeue, removeTab, hasCapacity, nextStartable };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaRunQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
