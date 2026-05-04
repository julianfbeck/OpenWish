import { formatShortDay } from "#/lib/format";

type AnalyticsLineChartProps = {
  points: Array<{
    date: string;
    views: number;
  }>;
};

export function AnalyticsLineChart({ points }: AnalyticsLineChartProps) {
  if (points.length === 0) {
    return (
      <div className="grid h-64 place-items-center rounded-md border border-dashed border-white/10 text-xs text-neutral-500">
        No views recorded yet.
      </div>
    );
  }

  const max = Math.max(...points.map((point) => point.views), 1);
  const width = 920;
  const height = 240;
  const paddingX = 18;
  const paddingY = 18;
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;

  const coordinates = points.map((point, index) => {
    const x =
      paddingX +
      (points.length === 1 ? innerWidth / 2 : (index / (points.length - 1)) * innerWidth);
    const y = paddingY + innerHeight - (point.views / max) * innerHeight;
    return { ...point, x, y };
  });

  const path = coordinates
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");

  return (
    <div className="overflow-hidden rounded-md border border-white/10 bg-neutral-950 p-4">
      <svg
        className="h-64 w-full"
        viewBox={`0 0 ${width} ${height + 48}`}
        role="img"
        aria-label="Daily views"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = paddingY + innerHeight * ratio;
          return (
            <line
              key={ratio}
              x1={paddingX}
              y1={y}
              x2={width - paddingX}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
            />
          );
        })}

        <path
          d={path}
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {coordinates.map((point) => (
          <g key={point.date}>
            <circle
              cx={point.x}
              cy={point.y}
              r="3"
              fill="#000"
              stroke="rgba(255,255,255,0.85)"
              strokeWidth="1.5"
            />
            <text
              x={point.x}
              y={height + 24}
              textAnchor="middle"
              fill="rgba(255,255,255,0.5)"
              fontSize="10"
            >
              {formatShortDay(point.date)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
