import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const DatabaseConnector = {
  list: async () => {
    return await fetch(`${API_BASE}/database-connectors`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .then((res) => res?.connectors || [])
      .catch((e) => {
        console.error(e);
        return [];
      });
  },

  create: async (data) => {
    return await fetch(`${API_BASE}/database-connectors`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { connector: null, error: e.message };
      });
  },

  update: async (id, data) => {
    return await fetch(`${API_BASE}/database-connectors/${id}`, {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { connector: null, error: e.message };
      });
  },

  delete: async (id, purge = false) => {
    return await fetch(
      `${API_BASE}/database-connectors/${id}?purgeDocuments=${purge}`,
      {
        method: "DELETE",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { success: false, error: e.message };
      });
  },

  test: async (config) => {
    return await fetch(`${API_BASE}/database-connectors/test`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(config),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { success: false, error: e.message };
      });
  },

  syncNow: async (id) => {
    return await fetch(`${API_BASE}/database-connectors/${id}/sync-now`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { queued: false, reason: e.message };
      });
  },

  logs: async (id, limit = 20) => {
    return await fetch(
      `${API_BASE}/database-connectors/${id}/logs?limit=${limit}`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .then((res) => res?.logs || [])
      .catch((e) => {
        console.error(e);
        return [];
      });
  },
};

export default DatabaseConnector;
