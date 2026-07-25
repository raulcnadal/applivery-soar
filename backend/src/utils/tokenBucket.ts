/**
 * Async token-bucket rate limiter. Used by AppliveryClient (services/appliveryClient.ts)
 * to cap outbound request volume to api.applivery.com, mirroring the original
 * FastAPI app's shared async token-bucket (ARCHITECTURE.md §2.3) — deliberately
 * conservative, well below Applivery's own published ceiling.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillRatePerSec: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  public async consume(tokensToConsume = 1): Promise<boolean> {
    this.refill();
    if (this.tokens >= tokensToConsume) {
      this.tokens -= tokensToConsume;
      return true;
    }
    return false;
  }

  /** Blocks (polling) until a token is available, then consumes it. */
  public async waitForToken(tokensToConsume = 1): Promise<void> {
    while (!(await this.consume(tokensToConsume))) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSeconds * this.refillRatePerSec);
    this.lastRefill = now;
  }
}
