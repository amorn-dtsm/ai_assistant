const { BaseChannelAdapter } = require("../BaseChannelAdapter");
const { TelegramBotService } = require("../../telegramBot");
const { telegramEndpoints } = require("../../../endpoints/telegram");

/**
 * Thin adapter wrapper around the existing TelegramBotService singleton.
 * ZERO logic beyond delegation — all behaviour lives in TelegramBotService.
 */
class TelegramAdapter extends BaseChannelAdapter {
  static type = "telegram";
  static deliveryMode = "polling";
  static supportsPairing = true;
  static credentialsSchema = {
    bot_token: {
      required: true,
      description: "Telegram bot API token from @BotFather",
    },
  };

  /** @type {TelegramBotService} */
  #service;

  constructor() {
    super();
    this.#service = new TelegramBotService(); // returns existing singleton
  }

  static async verifyCredentials({ bot_token }) {
    return TelegramBotService.verifyToken(bot_token);
  }

  static async bootIfActive() {
    return TelegramBotService.bootIfActive();
  }

  async start(config) {
    return this.#service.start(config);
  }

  async stop() {
    return this.#service.stop();
  }

  get isRunning() {
    return this.#service.isRunning;
  }

  registerRoutes(router) {
    telegramEndpoints(router);
  }
}

module.exports = { TelegramAdapter };
