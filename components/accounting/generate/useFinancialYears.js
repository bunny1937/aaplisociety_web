"use client";

import { useEffect, useState } from "react";

/** Financial Years for the caller's society, newest first. Auto-selects the newest as default. */
export function useFinancialYears() {
  const [years, setYears] = useState([]);
  const [financialYearId, setFinancialYearId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/accounting/financial-years", { credentials: "include" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to load financial years");
        if (cancelled) return;
        setYears(data.financialYears || []);
        if (data.financialYears?.length) setFinancialYearId(String(data.financialYears[0]._id));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { years, financialYearId, setFinancialYearId, loading, error };
}
