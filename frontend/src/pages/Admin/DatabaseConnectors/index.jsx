import Sidebar from "@/components/SettingsSidebar";
import ModalWrapper from "@/components/ModalWrapper";
import { useEffect, useState } from "react";
import { isMobile } from "react-device-detect";
import * as Skeleton from "react-loading-skeleton";
import { ArrowClockwise, X } from "@phosphor-icons/react";
import DatabaseConnector from "@/models/databaseConnector";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import ConnectorForm from "./ConnectorForm";

const ENGINES = [
  { value: "postgresql", label: "PostgreSQL" },
  { value: "mysql", label: "MySQL" },
  { value: "sql-server", label: "SQL Server" },
];

function defaultFormState() {
  return {
    name: "",
    engine: "postgresql",
    connectionConfig: {
      host: "",
      port: "5432",
      database: "",
      username: "",
      password: "",
    },
    query: "",
    contentColumns: "",
    metadataColumns: "",
    idColumn: "",
    timestampColumn: "",
    refreshFreqMinutes: 60,
    workspaceId: "",
    active: true,
  };
}

export default function DatabaseConnectorsPage() {
  const [loading, setLoading] = useState(true);
  const [connectors, setConnectors] = useState([]);
  const [workspaces, setWorkspaces] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editingConnector, setEditingConnector] = useState(null);
  const [deletingConnector, setDeletingConnector] = useState(null);
  const [expandedLogs, setExpandedLogs] = useState(null);

  async function fetchConnectors() {
    setLoading(true);
    const data = await DatabaseConnector.list();
    setConnectors(data);
    setLoading(false);
  }

  useEffect(() => {
    fetchConnectors();
    Workspace.all().then((ws) => setWorkspaces(ws));
  }, []);

  function handleCreate() {
    setEditingConnector(null);
    setShowForm(true);
  }

  function handleEdit(connector) {
    setEditingConnector(connector);
    setShowForm(true);
  }

  function handleCloseForm() {
    setShowForm(false);
    setEditingConnector(null);
  }

  function handleDeleteClick(connector) {
    setDeletingConnector(connector);
  }

  async function handleDeleteConfirm(purge) {
    if (!deletingConnector) return;
    const result = await DatabaseConnector.delete(deletingConnector.id, purge);
    if (result?.success) {
      showToast("Connector deleted.", "success");
      setDeletingConnector(null);
      fetchConnectors();
    } else {
      showToast(result?.error || "Failed to delete connector.", "error");
    }
  }

  async function handleToggleActive(connector) {
    const result = await DatabaseConnector.update(connector.id, {
      active: !connector.active,
    });
    if (result?.error) {
      showToast(result.error, "error");
      return;
    }
    showToast(
      `Connector ${connector.active ? "paused" : "resumed"}.`,
      "success"
    );
    fetchConnectors();
  }

  function handleToggleLogs(connectorId) {
    setExpandedLogs((prev) => (prev === connectorId ? null : connectorId));
  }

  async function handleSave(formData) {
    if (editingConnector) {
      const payload = buildUpdatePayload(formData);
      const result = await DatabaseConnector.update(
        editingConnector.id,
        payload
      );
      if (result?.error) {
        showToast(result.error, "error");
        return false;
      }
      showToast("Connector updated.", "success");
    } else {
      const payload = buildCreatePayload(formData);
      const result = await DatabaseConnector.create(payload);
      if (result?.error) {
        showToast(result.error, "error");
        return false;
      }
      showToast("Connector created.", "success");
    }

    handleCloseForm();
    fetchConnectors();
    return true;
  }

  async function handleSyncNow(connector) {
    const result = await DatabaseConnector.syncNow(connector.id);
    if (result?.queued) {
      showToast("Sync queued.", "success");
    } else {
      showToast(result?.reason || "Could not queue sync.", "warning");
    }
  }

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-[50px] md:py-6 py-16">
          <div className="w-full flex flex-col gap-y-1 pb-6 border-white/10 border-b-2">
            <div className="flex gap-x-4 items-center">
              <p className="text-lg leading-6 font-bold text-theme-text-primary">
                Database Connectors
              </p>
            </div>
            <p className="text-xs leading-[18px] font-base text-theme-text-secondary mt-2">
              Connect external SQL databases and automatically sync rows into
              workspace documents for RAG.
            </p>
          </div>

          {showForm ? (
            <ConnectorForm
              connector={editingConnector}
              workspaces={workspaces}
              engines={ENGINES}
              onSave={handleSave}
              onCancel={handleCloseForm}
            />
          ) : (
            <>
              <div className="w-full justify-end flex gap-x-2">
                <button
                  data-testid="db-connector-refresh-button"
                  onClick={fetchConnectors}
                  disabled={loading}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs border border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30 transition-colors h-[34px] mt-3 mb-4 md:-mb-14 z-10"
                >
                  <ArrowClockwise
                    size={14}
                    className={loading ? "animate-spin" : ""}
                  />
                  Refresh
                </button>
                <button
                  data-testid="db-connector-create-button"
                  onClick={handleCreate}
                  className="border-none text-xs px-4 py-1 font-semibold light:text-[#ffffff] rounded-lg bg-primary-button hover:bg-secondary hover:text-white h-[34px] whitespace-nowrap w-fit mt-3 mr-0 mb-4 md:-mb-14 z-10"
                >
                  <div className="flex items-center justify-center gap-2">
                    + New Connector
                  </div>
                </button>
              </div>
              <div className="overflow-x-auto mt-6">
                <ConnectorsList
                  loading={loading}
                  connectors={connectors}
                  workspaces={workspaces}
                  onEdit={handleEdit}
                  onDelete={handleDeleteClick}
                  onSyncNow={handleSyncNow}
                  onToggleActive={handleToggleActive}
                  expandedLogs={expandedLogs}
                  onToggleLogs={handleToggleLogs}
                />
              </div>
            </>
          )}

          <DeleteConnectorModal
            connector={deletingConnector}
            onConfirm={handleDeleteConfirm}
            onClose={() => setDeletingConnector(null)}
          />
        </div>
      </div>
    </div>
  );
}

function ConnectorsList({
  loading,
  connectors,
  workspaces,
  onEdit,
  onDelete,
  onSyncNow,
  onToggleActive,
  expandedLogs,
  onToggleLogs,
}) {
  if (loading) {
    return (
      <Skeleton.default
        height="80vh"
        width="100%"
        highlightColor="var(--theme-bg-primary)"
        baseColor="var(--theme-bg-secondary)"
        count={1}
        className="w-full p-4 rounded-b-2xl rounded-tr-2xl rounded-tl-sm"
        containerClassName="flex w-full"
      />
    );
  }

  if (connectors.length === 0) {
    return (
      <div className="w-full flex flex-col items-center justify-center py-12">
        <p className="text-theme-text-secondary text-sm">
          No database connectors configured yet.
        </p>
        <p className="text-theme-text-secondary text-xs mt-1">
          Click &ldquo;+ New Connector&rdquo; to add one.
        </p>
      </div>
    );
  }

  function workspaceName(id) {
    const ws = workspaces.find((w) => w.id === id);
    return ws?.name || `ID ${id}`;
  }

  function formatSyncStatus(connector) {
    if (connector.syncInProgress) return "Syncing…";
    if (!connector.lastSyncStatus) return "Never synced";
    return connector.lastSyncStatus;
  }

  function formatDate(dateStr) {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString();
  }

  function statusBadgeClasses(connector) {
    if (connector.syncInProgress)
      return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
    if (connector.lastSyncStatus === "success")
      return "bg-green-500/20 text-green-400 border border-green-500/30";
    if (connector.lastSyncStatus === "failed")
      return "bg-red-500/20 text-red-400 border border-red-500/30";
    return "bg-theme-bg-primary text-theme-text-secondary border border-white/10";
  }

  return (
    <table className="w-full text-xs text-left rounded-lg min-w-[800px] border-spacing-0">
      <thead className="text-theme-text-secondary text-xs leading-[18px] font-bold uppercase border-white/10 border-b">
        <tr>
          <th scope="col" className="px-6 py-3 rounded-tl-lg">
            Name
          </th>
          <th scope="col" className="px-6 py-3">
            Engine
          </th>
          <th scope="col" className="px-6 py-3">
            Workspace
          </th>
          <th scope="col" className="px-6 py-3">
            Interval
          </th>
          <th scope="col" className="px-6 py-3">
            Active
          </th>
          <th scope="col" className="px-6 py-3">
            Last Sync
          </th>
          <th scope="col" className="px-6 py-3 rounded-tr-lg">
            Actions
          </th>
        </tr>
      </thead>
      <tbody>
        {connectors.map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            workspaceName={workspaceName(connector.workspaceId)}
            onEdit={onEdit}
            onDelete={onDelete}
            onSyncNow={onSyncNow}
            onToggleActive={onToggleActive}
            isLogsExpanded={expandedLogs === connector.id}
            onToggleLogs={onToggleLogs}
            formatSyncStatus={formatSyncStatus}
            formatDate={formatDate}
            statusBadgeClasses={statusBadgeClasses}
          />
        ))}
      </tbody>
    </table>
  );
}

function ConnectorRow({
  connector,
  workspaceName,
  onEdit,
  onDelete,
  onSyncNow,
  onToggleActive,
  isLogsExpanded,
  onToggleLogs,
  formatSyncStatus,
  formatDate,
  statusBadgeClasses,
}) {
  return (
    <>
      <tr
        data-testid={`db-connector-row-${connector.name}`}
        className="border-b border-white/10 hover:bg-theme-bg-primary/50 transition-colors"
      >
        <td className="px-6 py-3 text-theme-text-primary font-medium">
          {connector.name}
        </td>
        <td className="px-6 py-3 text-theme-text-secondary">
          {connector.engine}
        </td>
        <td className="px-6 py-3 text-theme-text-secondary">
          {workspaceName}
        </td>
        <td className="px-6 py-3 text-theme-text-secondary">
          {connector.refreshFreqMinutes}m
        </td>
        <td className="px-6 py-3">
          <div className="flex items-center gap-2">
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                data-testid={`db-connector-active-toggle-${connector.name}`}
                type="checkbox"
                checked={connector.active}
                onChange={() => onToggleActive(connector)}
                className="sr-only peer"
              />
              <div className="w-8 h-4 bg-theme-bg-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500 border border-white/10" />
            </label>
            <span
              data-testid={`db-connector-active-badge-${connector.name}`}
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                connector.active
                  ? "bg-green-500/20 text-green-400 border border-green-500/30"
                  : "bg-red-500/20 text-red-400 border border-red-500/30"
              }`}
            >
              {connector.active ? "Active" : "Inactive"}
            </span>
          </div>
        </td>
        <td className="px-6 py-3">
          <div className="flex flex-col gap-0.5">
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold w-fit ${statusBadgeClasses(connector)}`}
            >
              {formatSyncStatus(connector)}
            </span>
            <span className="text-[10px] text-theme-text-secondary">
              {formatDate(connector.lastSyncAt)}
            </span>
          </div>
        </td>
        <td className="px-6 py-3">
          <div className="flex gap-x-2">
            <button
              data-testid={`db-connector-edit-${connector.name}`}
              onClick={() => onEdit(connector)}
              className="px-2 py-1 rounded text-xs border border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30 transition-colors"
            >
              Edit
            </button>
            <button
              data-testid={`db-connector-logs-${connector.name}`}
              onClick={() => onToggleLogs(connector.id)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                isLogsExpanded
                  ? "border-purple-500/50 text-purple-300 bg-purple-500/10"
                  : "border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30"
              }`}
            >
              Logs
            </button>
            <button
              data-testid={`db-connector-sync-${connector.name}`}
              onClick={() => onSyncNow(connector)}
              className="px-2 py-1 rounded text-xs border border-blue-500/30 text-blue-400 hover:bg-blue-500/10 transition-colors"
              disabled={!connector.active}
            >
              Sync Now
            </button>
            <button
              data-testid={`db-connector-delete-${connector.name}`}
              onClick={() => onDelete(connector)}
              className="px-2 py-1 rounded text-xs border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Delete
            </button>
          </div>
        </td>
      </tr>
      {isLogsExpanded && (
        <tr>
          <td colSpan={7} className="px-6 py-3 bg-theme-bg-primary/30">
            <ConnectorLogsView connectorId={connector.id} />
          </td>
        </tr>
      )}
    </>
  );
}

function ConnectorLogsView({ connectorId }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function fetchLogs() {
      setLoading(true);
      const data = await DatabaseConnector.logs(connectorId, 20);
      if (!cancelled) {
        setLogs(data);
        setLoading(false);
      }
    }
    fetchLogs();
    return () => {
      cancelled = true;
    };
  }, [connectorId]);

  function logStatusBadge(status) {
    if (status === "success")
      return "bg-green-500/20 text-green-400 border border-green-500/30";
    if (status === "failed")
      return "bg-red-500/20 text-red-400 border border-red-500/30";
    if (status === "running")
      return "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30";
    return "bg-theme-bg-primary text-theme-text-secondary border border-white/10";
  }

  if (loading) {
    return (
      <p className="text-xs text-theme-text-secondary py-2">Loading logs…</p>
    );
  }

  if (logs.length === 0) {
    return (
      <p className="text-xs text-theme-text-secondary py-2">
        No sync logs yet.
      </p>
    );
  }

  return (
    <table className="w-full text-[11px] text-left border-spacing-0">
      <thead className="text-theme-text-secondary uppercase border-b border-white/10">
        <tr>
          <th className="px-3 py-1.5">Started</th>
          <th className="px-3 py-1.5">Status</th>
          <th className="px-3 py-1.5">Read</th>
          <th className="px-3 py-1.5">Added</th>
          <th className="px-3 py-1.5">Updated</th>
          <th className="px-3 py-1.5">Skipped</th>
          <th className="px-3 py-1.5">Error</th>
        </tr>
      </thead>
      <tbody>
        {logs.map((log) => (
          <tr
            key={log.id}
            className="border-b border-white/5 text-theme-text-primary"
          >
            <td className="px-3 py-1.5 text-theme-text-secondary">
              {log.startedAt
                ? new Date(log.startedAt).toLocaleString()
                : "—"}
            </td>
            <td className="px-3 py-1.5">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${logStatusBadge(log.status)}`}
              >
                {log.status}
              </span>
            </td>
            <td className="px-3 py-1.5">{log.rowsRead ?? "—"}</td>
            <td className="px-3 py-1.5">{log.rowsAdded ?? "—"}</td>
            <td className="px-3 py-1.5">{log.rowsUpdated ?? "—"}</td>
            <td className="px-3 py-1.5">{log.rowsSkipped ?? "—"}</td>
            <td className="px-3 py-1.5 max-w-[200px]">
              {log.error ? (
                <span
                  className="truncate block text-red-400"
                  title={log.error}
                >
                  {log.error}
                </span>
              ) : (
                "—"
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DeleteConnectorModal({ connector, onConfirm, onClose }) {
  const [purge, setPurge] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!connector) return null;

  async function handleConfirm() {
    setDeleting(true);
    await onConfirm(purge);
    setDeleting(false);
    setPurge(false);
  }

  function handleClose() {
    if (deleting) return;
    setPurge(false);
    onClose();
  }

  return (
    <ModalWrapper isOpen={!!connector}>
      <div className="relative w-full max-w-lg bg-theme-bg-secondary rounded-lg shadow border-2 border-theme-modal-border">
        <div className="relative p-6 border-b rounded-t border-theme-modal-border">
          <h3 className="text-lg font-semibold text-white">
            Delete &ldquo;{connector.name}&rdquo;?
          </h3>
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-white/60 hover:text-white transition-colors"
          >
            <X size={20} weight="bold" />
          </button>
        </div>
        <div className="p-6 flex flex-col gap-y-4">
          <p className="text-sm text-white/70">
            This will permanently delete the connector and all its sync history.
            This action cannot be undone.
          </p>
          <p className="text-sm text-white/70">
            Synced documents will remain in the workspace unless you check the
            box below.
          </p>
          <label className="flex items-start gap-x-2 cursor-pointer">
            <input
              data-testid="db-connector-purge-checkbox"
              type="checkbox"
              checked={purge}
              onChange={(e) => setPurge(e.target.checked)}
              className="mt-0.5 rounded border-white/20 bg-theme-bg-primary text-red-500 focus:ring-red-500"
            />
            <span className="text-sm text-red-400">
              Also remove synced documents from the workspace
            </span>
          </label>
        </div>
        <div className="flex justify-end items-center gap-x-3 p-6 pt-0">
          <button
            onClick={handleClose}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm border border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleting ? "Deleting…" : "Delete Connector"}
          </button>
        </div>
      </div>
    </ModalWrapper>
  );
}

function buildCreatePayload(formData) {
  return {
    name: formData.name,
    engine: formData.engine,
    connectionConfig: {
      host: formData.connectionConfig.host,
      port: String(formData.connectionConfig.port),
      database: formData.connectionConfig.database,
      username: formData.connectionConfig.username,
      password: formData.connectionConfig.password,
    },
    query: formData.query,
    contentColumns: parseArrayField(formData.contentColumns),
    metadataColumns: parseArrayField(formData.metadataColumns),
    idColumn: formData.idColumn,
    timestampColumn: formData.timestampColumn || undefined,
    refreshFreqMinutes: Number(formData.refreshFreqMinutes) || 60,
    workspaceId: Number(formData.workspaceId),
    active: formData.active,
  };
}

function buildUpdatePayload(formData) {
  const payload = { ...buildCreatePayload(formData) };
  // If password is empty string, omit it from connectionConfig
  // (server preserves existing password when absent)
  if (!payload.connectionConfig.password) {
    delete payload.connectionConfig.password;
  }
  return payload;
}

function parseArrayField(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
