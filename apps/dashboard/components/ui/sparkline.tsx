export function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length === 0) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const points = data.map((value, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 35 - ((value - min) / range) * 35;
    return `${x},${y}`;
  });

  return (
    <svg width="100%" height="60" viewBox="0 -5 100 45" preserveAspectRatio="none" style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.4" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        fill={`url(#gradient-${color.replace('#', '')})`}
        stroke="none"
        points={`0,45 ${points.join(" ")} 100,45`}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points.join(" ")}
      />
    </svg>
  );
}
