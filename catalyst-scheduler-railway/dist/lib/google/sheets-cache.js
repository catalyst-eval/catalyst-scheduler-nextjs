"use strict";
// src/lib/google/sheets-cache.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetsCacheService = void 0;
class SheetsCacheService {
    constructor(defaultTTL = 60000) {
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }
    async getOrFetch(key, fetchFn, ttl = this.defaultTTL) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < ttl) {
            return cached.data;
        }
        const data = await fetchFn();
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        return data;
    }
    invalidate(key) {
        this.cache.delete(key);
    }
    clearAll() {
        this.cache.clear();
    }
}
exports.SheetsCacheService = SheetsCacheService;
exports.default = SheetsCacheService;
