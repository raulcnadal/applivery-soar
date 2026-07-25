import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { TokenBucket } from "../utils/tokenBucket";

/**
 * Single choke point for every outbound call to api.applivery.com — the Node
 * equivalent of the original app's `_applivery_call` (ARCHITECTURE.md §2.3).
 * Every new Applivery integration should go through this client rather than
 * calling axios directly, to stay inside the shared rate-limit budget.
 */
export class AppliveryClient {
  private readonly client: AxiosInstance;
  private readonly rateLimiter: TokenBucket;

  constructor() {
    // Capacity/refill deliberately conservative, well below Applivery's own
    // published ceiling — same values as the migration guidelines doc.
    this.rateLimiter = new TokenBucket(50, 10);
    this.client = axios.create({
      baseURL: env.appliveryApiUrl,
      timeout: 10_000,
    });
  }

  public async request<T = unknown>(config: AxiosRequestConfig, retries = 3): Promise<T> {
    await this.rateLimiter.waitForToken();

    try {
      const response = await this.client.request<T>(config);
      return response.data;
    } catch (error: any) {
      if (error?.response?.status === 429 && retries > 0) {
        const retryAfterSeconds = Number.parseInt(error.response.headers?.["retry-after"] ?? "2", 10);
        await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
        return this.request<T>(config, retries - 1);
      }
      throw error;
    }
  }

  public get<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: "GET", url });
  }

  public post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: "POST", url, data });
  }

  public put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: "PUT", url, data });
  }

  public delete<T = unknown>(url: string, config?: AxiosRequestConfig) {
    return this.request<T>({ ...config, method: "DELETE", url });
  }
}

// Shared singleton — every module imports this instance rather than
// constructing its own client (and its own separate rate-limit budget).
export const appliveryClient = new AppliveryClient();
