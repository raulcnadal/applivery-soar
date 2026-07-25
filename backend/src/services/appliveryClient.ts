import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";
import { env } from "../config/env";
import { TokenBucket } from "../utils/tokenBucket";

/**
 * Single choke point for every outbound call to api.applivery.io — the Node
 * equivalent of the original app's `_applivery_call` (ARCHITECTURE.md §2.3).
 * Every new Applivery integration should go through this client rather than
 * calling axios directly, to stay inside the shared rate-limit budget.
 *
 * Deliberately mirrors `_applivery_call`'s error model: this NEVER throws on
 * a non-2xx response (a 401 login failure, a 404, etc. is a normal, expected
 * outcome the caller inspects via `response.status`/`response.data`, exactly
 * like Python's `res.status_code`) — it only retries automatically on 429,
 * and only throws for genuine network-level failures (DNS, timeout,
 * connection refused).
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
      // Never throw on non-2xx — see class doc above.
      validateStatus: () => true,
    });
  }

  public async request<T = unknown>(config: AxiosRequestConfig, retries = 3): Promise<AxiosResponse<T>> {
    await this.rateLimiter.waitForToken();

    const response = await this.client.request<T>(config);

    if (response.status === 429 && retries > 0) {
      const retryAfterSeconds = Number.parseInt(String(response.headers?.["retry-after"] ?? "2"), 10);
      await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000));
      return this.request<T>(config, retries - 1);
    }

    return response;
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
