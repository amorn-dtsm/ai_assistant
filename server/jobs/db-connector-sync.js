const { syncAllDue } = require("../utils/DatabaseConnectors/syncEngine");
const { log, conclude } = require("./helpers/index.js");

(async () => {
  try {
    const results = await syncAllDue();

    if (results.length === 0) {
      log("No database connectors due for sync. Exiting.");
      return;
    }

    for (const result of results) {
      if (result.skipped) {
        log(`Connector ${result.connectorId} skipped: ${result.reason}`);
      } else if (result.success) {
        const c = result.counts || {};
        log(
          `Connector ${result.connectorId} synced — read: ${c.rowsRead || 0}, added: ${c.rowsAdded || 0}, updated: ${c.rowsUpdated || 0}, skipped: ${c.rowsSkipped || 0}`
        );
      } else {
        log(`Connector ${result.connectorId} failed: ${result.error}`);
      }
    }
  } catch (e) {
    console.error(e);
    log(`errored with ${e.message}`);
  } finally {
    conclude();
  }
})();
