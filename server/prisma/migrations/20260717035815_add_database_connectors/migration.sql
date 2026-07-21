-- CreateTable
CREATE TABLE "database_connectors" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "connectionConfig" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "contentColumns" TEXT NOT NULL,
    "metadataColumns" TEXT NOT NULL DEFAULT '[]',
    "idColumn" TEXT NOT NULL,
    "timestampColumn" TEXT NOT NULL,
    "refreshFreqMinutes" INTEGER NOT NULL DEFAULT 60,
    "batchSize" INTEGER NOT NULL DEFAULT 500,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "workspaceId" INTEGER NOT NULL,
    "lastSyncCursorTs" TEXT,
    "lastSyncCursorId" TEXT,
    "lastSyncAt" DATETIME,
    "lastSyncStatus" TEXT,
    "lastSyncError" TEXT,
    "syncInProgress" BOOLEAN NOT NULL DEFAULT false,
    "syncStartedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUpdatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "database_connectors_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "database_connector_sync_logs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "connectorId" INTEGER NOT NULL,
    "startedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL,
    "rowsRead" INTEGER NOT NULL DEFAULT 0,
    "rowsAdded" INTEGER NOT NULL DEFAULT 0,
    "rowsUpdated" INTEGER NOT NULL DEFAULT 0,
    "rowsSkipped" INTEGER NOT NULL DEFAULT 0,
    "cursorBefore" TEXT,
    "cursorAfter" TEXT,
    "error" TEXT,
    CONSTRAINT "database_connector_sync_logs_connectorId_fkey" FOREIGN KEY ("connectorId") REFERENCES "database_connectors" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "database_connectors_name_key" ON "database_connectors"("name");

-- CreateIndex
CREATE INDEX "database_connectors_workspaceId_idx" ON "database_connectors"("workspaceId");

-- CreateIndex
CREATE INDEX "database_connector_sync_logs_connectorId_idx" ON "database_connector_sync_logs"("connectorId");
