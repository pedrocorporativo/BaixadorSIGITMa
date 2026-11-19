(function (root) {
  "use strict";

  async function runSequential(items, processItem, { shouldStop = () => false, onResult = () => {} } = {}) {
    const results = [];
    for (const item of items) {
      if (shouldStop()) break;
      let entry;
      try {
        entry = { item, ok: true, result: await processItem(item) };
      } catch (error) {
        entry = { item, ok: false, error: error.message };
      }
      results.push(entry);
      onResult(entry);
    }
    return results;
  }

  const api = { runSequential };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BaixaQueue = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
