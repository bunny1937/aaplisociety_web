const API_BASE = "/api/admin";
const ADMIN_HEADERS = {};
export const adminApi = {
  async fetchSocieties() {
    const res = await fetch(`${API_BASE}/societies`, {
      credentials: "include",
      headers: ADMIN_HEADERS,
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
  async fetchSociety(id) {
    const res = await fetch(`${API_BASE}/societies/${id}`, {
      credentials: "include",
      headers: ADMIN_HEADERS,
    });
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
  async fetchData(societyId, collection) {
    const res = await fetch(
      `${API_BASE}/data-browser?societyId=${societyId}&collection=${collection}`,
      {
        credentials: "include",
        headers: ADMIN_HEADERS,
      },
    );
    if (!res.ok) throw new Error("Failed to fetch");
    return res.json();
  },
  async updateSociety(societyId, updates) {
    const res = await fetch(`${API_BASE}/societies`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json", ...ADMIN_HEADERS },
      body: JSON.stringify({ societyId, updates }),
    });
    if (!res.ok) throw new Error("Failed to update");
    return res.json();
  },
};
