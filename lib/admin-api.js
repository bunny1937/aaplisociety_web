const API_BASE = "/api/admin";

export const adminApi = {
  async fetchSocieties() {
    const res = await fetch(`${API_BASE}/societies`, {
      credentials: "include",
      headers: {},
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },

  async fetchSociety(id) {
    const res = await fetch(`${API_BASE}/societies/${id}`, {
      credentials: "include",
      headers: {},
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },

  async fetchData(societyId, collection) {
    const res = await fetch(
      `${API_BASE}/data-browser?societyId=${societyId}&collection=${collection}`,
      {
        credentials: "include",
      },
    );
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },

  async updateSociety(societyId, updates) {
    const res = await fetch(`${API_BASE}/...`, {
      method: "PUT",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ societyId, updates }),
    });
    if (!res.ok) throw new Error("Failed to update");
    return res.json();
  },
};
