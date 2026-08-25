"use client";

import React from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";

interface RadarPoint {
  axis: string;
  value: number;
}

interface AnalysisRadarProps {
  data: RadarPoint[];
}

export default function AnalysisRadar({ data }: AnalysisRadarProps) {
  const chartData = data.map(d => ({
    ...d,
    full: 10
  }));

  return (
    <div className="w-full h-full min-h-[300px] flex items-center justify-center">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="75%" data={chartData}>
          <PolarGrid
            stroke="var(--outline-variant)"
            strokeOpacity={0.3}
            gridType="polygon"
          />
          <PolarAngleAxis
            dataKey="axis"
            tick={{ fill: "var(--secondary)", fontSize: 9, fontWeight: 600 }}
            stroke="var(--outline-variant)"
            strokeOpacity={0.2}
          />
          <PolarRadiusAxis
            domain={[0, 10]}
            tick={false}
            axisLine={false}
          />
          <Radar
            name="Virality DNA"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            fill="var(--primary)"
            fillOpacity={0.12}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
