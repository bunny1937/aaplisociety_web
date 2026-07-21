"use client";
export function Skeleton({ width = "100%", height = 14, radius = 6, className = "", style = {} }) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}
export function SkeletonCard({ rows = 3 }) {
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Skeleton height={20} width="55%" radius={8} />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} height={13} width={i === rows - 1 ? "70%" : "100%"} />
      ))}
    </div>
  );
}
export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton height={11} width={`${60 + Math.random() * 30}%`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton height={13} width={`${50 + Math.random() * 45}%`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function SkeletonStats({ count = 4 }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${count}, 1fr)`,
      gap: 16,
    }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={11} width="50%" />
          <Skeleton height={28} width="65%" radius={8} />
          <Skeleton height={10} width="40%" />
        </div>
      ))}
    </div>
  );
}
export function SkeletonPageHeader() {
  return (
    <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Skeleton height={22} width={220} radius={8} />
        <Skeleton height={13} width={160} />
      </div>
      <Skeleton height={38} width={130} radius={10} />
    </div>
  );
}
