import { useState } from "react";
import DatabaseConnector from "@/models/databaseConnector";
import showToast from "@/utils/toast";

const DEFAULT_PORTS = {
  postgresql: "5432",
  mysql: "3306",
  "sql-server": "1433",
};

export default function ConnectorForm({
  connector,
  workspaces,
  engines,
  onSave,
  onCancel,
}) {
  const isEditing = !!connector;

  const [form, setForm] = useState(() => {
    if (connector) {
      return {
        name: connector.name || "",
        engine: connector.engine || "postgresql",
        connectionConfig: {
          host: connector.connectionConfig?.host || "",
          port: String(
            connector.connectionConfig?.port ||
              DEFAULT_PORTS[connector.engine] ||
              "5432"
          ),
          database: connector.connectionConfig?.database || "",
          username: connector.connectionConfig?.username || "",
          password: "", // never pre-fill password
        },
        query: connector.query || "",
        contentColumns: Array.isArray(connector.contentColumns)
          ? connector.contentColumns.join(", ")
          : connector.contentColumns || "",
        metadataColumns: Array.isArray(connector.metadataColumns)
          ? connector.metadataColumns.join(", ")
          : connector.metadataColumns || "",
        idColumn: connector.idColumn || "",
        timestampColumn: connector.timestampColumn || "",
        refreshFreqMinutes: connector.refreshFreqMinutes || 60,
        workspaceId: connector.workspaceId || "",
        active: connector.active !== undefined ? connector.active : true,
      };
    }
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
  });

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function updateConfig(field, value) {
    setForm((prev) => ({
      ...prev,
      connectionConfig: { ...prev.connectionConfig, [field]: value },
    }));
  }

  function handleEngineChange(engine) {
    updateField("engine", engine);
    updateConfig("port", DEFAULT_PORTS[engine] || "5432");
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      // For test, we need a password.
      // When editing, if password is blank, warn user.
      if (isEditing && !form.connectionConfig.password) {
        setTestResult({
          success: false,
          error:
            "Enter the password to test the connection. It is not displayed for security.",
        });
        setTesting(false);
        return;
      }

      const result = await DatabaseConnector.test({
        engine: form.engine,
        connectionConfig: {
          host: form.connectionConfig.host,
          port: String(form.connectionConfig.port),
          database: form.connectionConfig.database,
          username: form.connectionConfig.username,
          password: form.connectionConfig.password,
        },
        query: form.query,
      });
      setTestResult(result);
      if (result.success) {
        showToast("Connection successful!", "success");
      }
    } catch (e) {
      setTestResult({ success: false, error: e.message });
    }
    setTesting(false);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-base font-bold text-theme-text-primary">
          {isEditing ? `Edit Connector: ${connector.name}` : "New Connector"}
        </h2>
        <button
          data-testid="db-connector-cancel-button"
          onClick={onCancel}
          className="px-3 py-1 rounded text-xs border border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30 transition-colors"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-y-5">
        {/* Name */}
        <FieldGroup label="Connector Name">
          <input
            data-testid="db-connector-name-input"
            type="text"
            value={form.name}
            onChange={(e) => updateField("name", e.target.value)}
            placeholder="e.g. Product Catalog"
            required
            className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </FieldGroup>

        {/* Engine */}
        <FieldGroup label="Database Engine">
          <select
            data-testid="db-connector-engine-select"
            value={form.engine}
            onChange={(e) => handleEngineChange(e.target.value)}
            className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {engines.map((eng) => (
              <option key={eng.value} value={eng.value}>
                {eng.label}
              </option>
            ))}
          </select>
        </FieldGroup>

        {/* Connection Config */}
        <fieldset className="border border-white/10 rounded-lg p-4">
          <legend className="text-xs font-semibold text-theme-text-secondary px-2 uppercase tracking-wide">
            Connection
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="Host">
              <input
                data-testid="db-connector-host-input"
                type="text"
                value={form.connectionConfig.host}
                onChange={(e) => updateConfig("host", e.target.value)}
                placeholder="localhost"
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Port">
              <input
                data-testid="db-connector-port-input"
                type="text"
                value={form.connectionConfig.port}
                onChange={(e) => updateConfig("port", e.target.value)}
                placeholder={DEFAULT_PORTS[form.engine]}
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Database">
              <input
                data-testid="db-connector-database-input"
                type="text"
                value={form.connectionConfig.database}
                onChange={(e) => updateConfig("database", e.target.value)}
                placeholder="mydb"
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Username">
              <input
                data-testid="db-connector-username-input"
                type="text"
                value={form.connectionConfig.username}
                onChange={(e) => updateConfig("username", e.target.value)}
                placeholder="postgres"
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Password" className="md:col-span-2">
              <input
                data-testid="db-connector-password-input"
                type="password"
                value={form.connectionConfig.password}
                onChange={(e) => updateConfig("password", e.target.value)}
                placeholder={isEditing ? "••••••••" : "Enter password"}
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {isEditing && (
                <p className="text-[10px] text-theme-text-secondary mt-1">
                  Leave blank to keep the existing password.
                </p>
              )}
            </FieldGroup>
          </div>
        </fieldset>

        {/* SQL Query */}
        <FieldGroup label="SQL Query">
          <textarea
            data-testid="db-connector-query-input"
            value={form.query}
            onChange={(e) => updateField("query", e.target.value)}
            placeholder="SELECT id, title, body, category, updated_at FROM articles WHERE published = true"
            required
            rows={4}
            className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary font-mono placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
          />
          <p className="text-[10px] text-theme-text-secondary mt-1">
            Read-only SELECT query. No semicolons, no multiple statements.
          </p>
        </FieldGroup>

        {/* Column Mapping */}
        <fieldset className="border border-white/10 rounded-lg p-4">
          <legend className="text-xs font-semibold text-theme-text-secondary px-2 uppercase tracking-wide">
            Column Mapping
          </legend>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FieldGroup label="Content Columns (comma-separated)">
              <input
                data-testid="db-connector-content-columns-input"
                type="text"
                value={form.contentColumns}
                onChange={(e) => updateField("contentColumns", e.target.value)}
                placeholder="title, body"
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Metadata Columns (comma-separated)">
              <input
                data-testid="db-connector-metadata-columns-input"
                type="text"
                value={form.metadataColumns}
                onChange={(e) => updateField("metadataColumns", e.target.value)}
                placeholder="category, author"
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="ID Column">
              <input
                data-testid="db-connector-id-column-input"
                type="text"
                value={form.idColumn}
                onChange={(e) => updateField("idColumn", e.target.value)}
                placeholder="id"
                required
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
            <FieldGroup label="Timestamp Column (optional)">
              <input
                data-testid="db-connector-timestamp-column-input"
                type="text"
                value={form.timestampColumn}
                onChange={(e) => updateField("timestampColumn", e.target.value)}
                placeholder="updated_at"
                className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary/50 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </FieldGroup>
          </div>
        </fieldset>

        {/* Sync Settings */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <FieldGroup label="Refresh Interval (minutes)">
            <input
              data-testid="db-connector-refresh-freq-input"
              type="number"
              min={1}
              value={form.refreshFreqMinutes}
              onChange={(e) =>
                updateField("refreshFreqMinutes", Number(e.target.value))
              }
              className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </FieldGroup>

          <FieldGroup label="Target Workspace">
            <select
              data-testid="db-connector-workspace-select"
              value={form.workspaceId}
              onChange={(e) => updateField("workspaceId", e.target.value)}
              required
              className="w-full rounded-lg border border-white/10 bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select a workspace…</option>
              {workspaces.map((ws) => (
                <option key={ws.id} value={ws.id}>
                  {ws.name}
                </option>
              ))}
            </select>
          </FieldGroup>

          <FieldGroup label="Active">
            <label className="relative inline-flex items-center cursor-pointer mt-1">
              <input
                data-testid="db-connector-active-toggle"
                type="checkbox"
                checked={form.active}
                onChange={(e) => updateField("active", e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-theme-bg-primary rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-green-500 border border-white/10" />
              <span className="ml-2 text-sm text-theme-text-secondary">
                {form.active ? "Enabled" : "Disabled"}
              </span>
            </label>
          </FieldGroup>
        </div>

        {/* Test Connection */}
        <div className="border border-white/10 rounded-lg p-4">
          <div className="flex items-center gap-x-3">
            <button
              data-testid="db-connector-test-button"
              type="button"
              onClick={handleTest}
              disabled={testing}
              className="px-4 py-2 rounded-lg text-sm font-medium border border-blue-500/40 text-blue-400 hover:bg-blue-500/10 disabled:opacity-50 transition-colors"
            >
              {testing ? "Testing…" : "Test Connection"}
            </button>
            {testResult && (
              <span
                data-testid="db-connector-test-result"
                className={`text-xs font-medium ${
                  testResult.success ? "text-green-400" : "text-red-400"
                }`}
              >
                {testResult.success
                  ? `Connected — ${testResult.columns?.length || 0} columns found`
                  : testResult.error}
              </span>
            )}
          </div>

          {/* Sample Rows Preview */}
          {testResult?.success && testResult.sampleRows?.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <p className="text-xs text-theme-text-secondary mb-2 font-medium">
                Preview (up to 5 rows):
              </p>
              <table className="w-full text-[11px] text-left border-spacing-0">
                <thead className="text-theme-text-secondary uppercase border-b border-white/10">
                  <tr>
                    {testResult.columns.map((col) => (
                      <th key={col} className="px-3 py-1.5">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {testResult.sampleRows.map((row, i) => (
                    <tr
                      key={i}
                      className="border-b border-white/5 text-theme-text-primary"
                    >
                      {testResult.columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 max-w-[200px] truncate">
                          {String(row[col] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Submit */}
        <div className="flex justify-end gap-x-3 pt-2 border-t border-white/10">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm border border-white/10 text-theme-text-secondary hover:text-white hover:border-white/30 transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="db-connector-save-button"
            type="submit"
            disabled={saving}
            className="border-none text-xs px-6 py-1 font-semibold light:text-[#ffffff] rounded-lg bg-primary-button hover:bg-secondary hover:text-white h-[34px] whitespace-nowrap w-fit disabled:opacity-50"
          >
            <div className="flex items-center justify-center gap-2">
              {saving
                ? "Saving…"
                : isEditing
                  ? "Update Connector"
                  : "Create Connector"}
            </div>
          </button>
        </div>
      </form>
    </div>
  );
}

function FieldGroup({ label, children, className = "" }) {
  return (
    <div className={`flex flex-col gap-y-1 ${className}`}>
      <label className="text-xs font-medium text-theme-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
