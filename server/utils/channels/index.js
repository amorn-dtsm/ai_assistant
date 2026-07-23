const { TelegramAdapter } = require("./telegram");
const LineAdapter = require("./line");

/**
 * Explicit channel adapter registry.
 * Add new adapters here — NO filesystem scanning.
 * @type {Array<typeof import('./BaseChannelAdapter').BaseChannelAdapter>}
 */
const CHANNELS = [TelegramAdapter, LineAdapter];

/** @type {Map<string, import('./BaseChannelAdapter').BaseChannelAdapter>} */
const _instances = new Map();

/**
 * Get (or lazily create) a singleton adapter instance by type.
 * @param {string} type
 * @returns {import('./BaseChannelAdapter').BaseChannelAdapter|null}
 */
function getAdapter(type) {
  const AdapterClass = CHANNELS.find((c) => c.type === type);
  if (!AdapterClass) return null;
  if (!_instances.has(type)) {
    _instances.set(type, new AdapterClass());
  }
  return _instances.get(type);
}

/**
 * Mount every adapter's HTTP routes onto the given router.
 * @param {import('express').Router} router
 */
function registerAllRoutes(router) {
  for (const AdapterClass of CHANNELS) {
    const adapter = getAdapter(AdapterClass.type);
    adapter.registerRoutes(router);
  }
}

/**
 * Boot all active adapters with per-adapter isolation.
 * Uses Promise.allSettled so one failure doesn't block others.
 */
async function bootAllIfActive() {
  const results = await Promise.allSettled(
    CHANNELS.map((AdapterClass) => AdapterClass.bootIfActive())
  );
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      console.error(
        `[ChannelBoot] ${CHANNELS[i].type} failed:`,
        results[i].reason?.message || String(results[i].reason)
      );
    }
  }
}

module.exports = {
  CHANNELS,
  getAdapter,
  registerAllRoutes,
  bootAllIfActive,
};
