<<<<<<< Updated upstream
// Coalesces concurrent 401s into a single refresh call instead of each
// in-flight request racing its own refresh attempt (which would rotate the
// refresh token multiple times and invalidate the others via the
// rotate-on-use design in lib/refresh-token.js).
let refreshInFlight = null;

async function attemptRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function redirectToLogin() {
  if (typeof window !== "undefined") {
    window.location.href = "/auth/login";
  }
}

class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async request(endpoint, options = {}, _isRetry = false) {
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${normalized}`;

    const config = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // ← Sends HttpOnly cookies automatically
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        // One silent-refresh retry per request — a refresh-endpoint 401
        // itself (refresh token also expired/revoked) or a retry that still
        // 401s means the session is genuinely over.
        if (!_isRetry && normalized !== "/api/auth/refresh") {
          const refreshed = await attemptRefresh();
          if (refreshed) return this.request(endpoint, options, true);
        }
        redirectToLogin();
        throw new Error("Unauthorized");
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || data.message || "Request failed");
        }
        return data;
      }

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: "GET" });
  }

  post(endpoint, body) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  put(endpoint, body) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: "DELETE" });
  }

  async upload(endpoint, formData, _isRetry = false) {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include", // ← Send cookies
        body: formData, // Don't set Content-Type for FormData
      });

      if (response.status === 401) {
        if (!_isRetry) {
          const refreshed = await attemptRefresh();
          if (refreshed) return this.upload(endpoint, formData, true);
        }
        redirectToLogin();
        throw new Error("Unauthorized");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      return data;
    } catch (error) {
      console.error(`Upload Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async download(endpoint, filename) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      credentials: "include", // ← Send cookies
    });

    if (!response.ok) {
      throw new Error("Download failed");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

export const apiClient = new ApiClient("");
=======
// Coalesces concurrent 401s into a single refresh call instead of each
// in-flight request racing its own refresh attempt (which would rotate the
// refresh token multiple times and invalidate the others via the
// rotate-on-use design in lib/refresh-token.js).
let refreshInFlight = null;

async function attemptRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = fetch("/api/auth/refresh", { method: "POST", credentials: "include" })
      .then((res) => res.ok)
      .catch(() => false)
      .finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

function redirectToLogin() {
  if (typeof window !== "undefined") {
    window.location.href = "/auth/login";
  }
}

class ApiClient {
  constructor(baseUrl = "") {
    this.baseUrl = baseUrl;
  }

  async request(endpoint, options = {}, _isRetry = false) {
    const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    const url = `${this.baseUrl}${normalized}`;

    const config = {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      credentials: "include", // ← Sends HttpOnly cookies automatically
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401) {
        // One silent-refresh retry per request — a refresh-endpoint 401
        // itself (refresh token also expired/revoked) or a retry that still
        // 401s means the session is genuinely over.
        if (!_isRetry && normalized !== "/api/auth/refresh") {
          const refreshed = await attemptRefresh();
          if (refreshed) return this.request(endpoint, options, true);
        }
        redirectToLogin();
        throw new Error("Unauthorized");
      }

      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || data.message || "Request failed");
        }
        return data;
      }

      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      return response;
    } catch (error) {
      console.error(`API Error [${endpoint}]:`, error);
      throw error;
    }
  }

  get(endpoint) {
    return this.request(endpoint, { method: "GET" });
  }

  post(endpoint, body) {
    return this.request(endpoint, {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  put(endpoint, body) {
    return this.request(endpoint, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }

  delete(endpoint) {
    return this.request(endpoint, { method: "DELETE" });
  }

  async upload(endpoint, formData, _isRetry = false) {
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        credentials: "include", // ← Send cookies
        body: formData, // Don't set Content-Type for FormData
      });

      if (response.status === 401) {
        if (!_isRetry) {
          const refreshed = await attemptRefresh();
          if (refreshed) return this.upload(endpoint, formData, true);
        }
        redirectToLogin();
        throw new Error("Unauthorized");
      }

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Upload failed");
      }

      return data;
    } catch (error) {
      console.error(`Upload Error [${endpoint}]:`, error);
      throw error;
    }
  }

  async download(endpoint, filename) {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      credentials: "include", // ← Send cookies
    });

    if (!response.ok) {
      throw new Error("Download failed");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download";
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }
}

export const apiClient = new ApiClient("");
>>>>>>> Stashed changes
