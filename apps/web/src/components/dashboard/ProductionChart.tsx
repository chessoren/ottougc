"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface DayPoint {
  day: string;
  produced: number;
  published: number;
  views: number;
}

/**
 * Production over time.
 *
 * Two series on one axis on purpose: the gap between *produced* and *published*
 * is the number an operator needs to see. A widening gap means the pipeline is
 * making videos that never reach a channel — a quota problem, a QA problem, or a
 * disconnected account — and it is invisible on either series alone.
 */
export function ProductionChart({ data }: { data: DayPoint[] }) {
  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="produced" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.24} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="published" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-win)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-win)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={(d: string) => d.slice(8)}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={18}
          />
          <YAxis
            allowDecimals={false}
            tick={{ fontSize: 11, fill: "var(--color-ink-faint)" }}
            axisLine={false}
            tickLine={false}
            width={44}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-surface)",
              border: "1px solid var(--color-line)",
              borderRadius: 12,
              fontSize: 13,
              boxShadow: "var(--shadow-md)",
            }}
            labelFormatter={(d: string) =>
              new Date(d).toLocaleDateString("en-US", { day: "numeric", month: "long" })
            }
            formatter={(value: number, name: string) => [
              value,
              name === "produced" ? "made" : "posted",
            ]}
          />
          <Area
            type="monotone"
            dataKey="produced"
            stroke="var(--color-accent)"
            strokeWidth={2}
            fill="url(#produced)"
          />
          <Area
            type="monotone"
            dataKey="published"
            stroke="var(--color-win)"
            strokeWidth={2}
            fill="url(#published)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
