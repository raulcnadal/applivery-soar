export interface WidgetResponse {
  chartData: Array<{ name: string; value: number }>;
  trendData: { labels: string[]; series: number[]; os_totals: Record<string, number> };
  scorecardValue: number;
  items: any[];
  orgProfile: Record<string, any>;
}

/** Port of the frontend's GET /api/analytics/widget call (main.py:14386). */
export async function fetchWidgetData(source: string, filters: Record<string, any> = {}, dateIni?: string | null, dateEnd?: string | null): Promise<WidgetResponse> {
  const { api } = await import("../api/http");
  const res = await api.get("/analytics/widget", {
    params: { source, chart_type: "list", filters: JSON.stringify(filters ?? {}), dateIni: dateIni ?? undefined, dateEnd: dateEnd ?? undefined },
  });
  return res.data;
}
