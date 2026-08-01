"use client";

import { useEffect, useState } from "react";

/**
 * Society details for statement headers/print. Admin/Secretary/Accountant
 * logins carry only `societyId` on /api/auth/me (no name) — the real name,
 * address and registration number live on the Society doc, so this always
 * resolves through /api/society/config. Member-profile logins (which do
 * carry a denormalized societyName on /api/auth/me) are used only as a
 * same-tick fallback while the config call is in flight.
 */
export function useSocietyName() {
  const [society, setSociety] = useState({ name: null, address: null, registrationNo: null });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/society/config", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.society) return;
        setSociety({
          name: data.society.name || null,
          address: data.society.address || null,
          registrationNo: data.society.registrationNo || null,
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return society;
}
