/**
 * Base class for all channel adapters (Telegram, LINE, etc.).
 * Transport-only abstraction — no chat-engine methods.
 *
 * Subclasses MUST override: start(), stop(), verifyCredentials().
 * Webhook adapters should also override registerRoutes().
 */
class BaseChannelAdapter {
  /** @type {string|null} Channel identifier, e.g. "telegram", "line" */
  static type = null;

  /** @type {"polling"|"webhook"} How the adapter receives messages */
  static deliveryMode = "polling";

  /** @type {boolean} Whether admin pairing routes are exposed */
  static supportsPairing = false;

  /**
   * Schema describing required credentials for this adapter.
   * @type {Object.<string, {required: boolean, description: string}>}
   */
  static credentialsSchema = {};

  /**
   * Idempotent resume from DB — called on server boot to restart
   * any adapters that were previously active.
   * @returns {Promise<void>}
   */
  static async bootIfActive() {
    // Base no-op; subclasses override to resume from persisted state.
  }

  /**
   * Validate that the given credentials are usable for this adapter.
   * @param {object} _creds
   * @returns {Promise<void>}
   */
  static async verifyCredentials(_creds) {
    throw new Error("Not implemented");
  }

  /**
   * Start the adapter with the given config.
   * @param {object} _config
   * @returns {Promise<void>}
   */
  async start(_config) {
    throw new Error("Not implemented");
  }

  /**
   * Stop the adapter and clean up resources.
   * @returns {Promise<void>}
   */
  async stop() {
    throw new Error("Not implemented");
  }

  /**
   * Whether this adapter instance is currently running.
   * @returns {boolean}
   */
  get isRunning() {
    return false;
  }

  /**
   * Mount any HTTP routes this adapter needs (webhooks, admin endpoints).
   * @param {import('express').Router} _router
   */
  registerRoutes(_router) {
    // Base no-op; webhook adapters override to mount their endpoints.
  }
}

/**
 * Validate that an adapter class conforms to the BaseChannelAdapter contract.
 * Throws a descriptive error naming the first check that failed.
 *
 * @param {typeof BaseChannelAdapter} AdapterClass
 * @throws {Error} If any shape check fails
 */
function validateAdapterShape(AdapterClass) {
  if (typeof AdapterClass.type !== "string" || AdapterClass.type === null) {
    throw new Error(
      `Adapter shape error: 'type' must be a non-null string, got ${JSON.stringify(AdapterClass.type)}`
    );
  }

  if (
    AdapterClass.deliveryMode !== "polling" &&
    AdapterClass.deliveryMode !== "webhook"
  ) {
    throw new Error(
      `Adapter shape error: 'deliveryMode' must be "polling" or "webhook", got ${JSON.stringify(AdapterClass.deliveryMode)}`
    );
  }

  if (
    typeof AdapterClass.credentialsSchema !== "object" ||
    AdapterClass.credentialsSchema === null ||
    Array.isArray(AdapterClass.credentialsSchema)
  ) {
    throw new Error(
      `Adapter shape error: 'credentialsSchema' must be a plain object, got ${typeof AdapterClass.credentialsSchema}`
    );
  }

  for (const [field, schema] of Object.entries(
    AdapterClass.credentialsSchema
  )) {
    if (typeof schema.required !== "boolean") {
      throw new Error(
        `Adapter shape error: credentialsSchema['${field}'] is missing 'required' (boolean)`
      );
    }
    if (typeof schema.description !== "string") {
      throw new Error(
        `Adapter shape error: credentialsSchema['${field}'] is missing 'description' (string)`
      );
    }
  }

  if (typeof AdapterClass.bootIfActive !== "function") {
    throw new Error(
      `Adapter shape error: 'bootIfActive' must be a function, got ${typeof AdapterClass.bootIfActive}`
    );
  }
}

module.exports = { BaseChannelAdapter, validateAdapterShape };
