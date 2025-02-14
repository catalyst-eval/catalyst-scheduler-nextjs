// src/lib/cache/appointments.ts

import type { IntakeQAppointment } from '@/types/webhooks';

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresAt: number;
}

export class AppointmentCache {
  private cache: Map<string, CacheEntry<any>>;
  private readonly defaultTTL: number; // Time to live in milliseconds

  constructor(defaultTTLMinutes: number = 5) {
    this.cache = new Map();
    this.defaultTTL = defaultTTLMinutes * 60 * 1000;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  async set<T>(key: string, data: T, ttlMinutes?: number): Promise<void> {
    const ttl = (ttlMinutes || this.defaultTTL / 60000) * 60000;
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      expiresAt: Date.now() + ttl
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }
  }
}