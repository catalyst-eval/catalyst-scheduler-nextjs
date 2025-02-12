// src/lib/google/sheets-cache.ts

interface CacheEntry<T> {
    data: T;
    timestamp: number;
  }
  
  interface CacheOptions {
    ttl: number; // Time to live in milliseconds
  }
  
  export class SheetsCacheService {
    private cache: Map<string, CacheEntry<any>> = new Map();
    private defaultTTL = 60000; // 1 minute default TTL
    private retryDelays = [1000, 2000, 4000, 8000]; // Exponential backoff delays
  
    constructor(private options?: CacheOptions) {}
  
    /**
     * Get data from cache or fetch using provided function
     */
    async getOrFetch<T>(
      key: string,
      fetchFn: () => Promise<T>,
      ttl: number = this.defaultTTL
    ): Promise<T> {
      const cached = this.cache.get(key);
      const now = Date.now();
  
      if (cached && now - cached.timestamp < ttl) {
        return cached.data;
      }
  
      // Implement exponential backoff for API calls
      let lastError;
      for (let i = 0; i < this.retryDelays.length; i++) {
        try {
          const data = await fetchFn();
          this.cache.set(key, { data, timestamp: now });
          return data;
        } catch (error) {
          lastError = error;
          if (this.isQuotaError(error)) {
            console.log(`Rate limit hit, retrying in ${this.retryDelays[i]}ms...`);
            await this.delay(this.retryDelays[i]);
            continue;
          }
          throw error;
        }
      }
  
      // If we've exhausted all retries
      if (cached) {
        console.warn('Returning stale data after fetch failures');
        return cached.data;
      }
  
      throw lastError;
    }
  
    /**
     * Clear specific cache entry
     */
    invalidate(key: string): void {
      this.cache.delete(key);
    }
  
    /**
     * Clear all cache entries
     */
    clearAll(): void {
      this.cache.clear();
    }
  
    /**
     * Check if error is a quota exceeded error
     */
    private isQuotaError(error: any): boolean {
      return (
        error?.response?.status === 429 ||
        error?.message?.includes('Quota exceeded') ||
        error?.code === 429
      );
    }
  
    /**
     * Delay promise
     */
    private delay(ms: number): Promise<void> {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  }