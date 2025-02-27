"use strict";
// src/lib/google/sheets-cache.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SheetsCacheService = void 0;
class SheetsCacheService {
    constructor(defaultTTL = 60000) {
        this.cache = new Map();
        this.defaultTTL = defaultTTL;
    }
    getOrFetch(key_1, fetchFn_1) {
        return __awaiter(this, arguments, void 0, function* (key, fetchFn, ttl = this.defaultTTL) {
            const cached = this.cache.get(key);
            if (cached && Date.now() - cached.timestamp < ttl) {
                return cached.data;
            }
            const data = yield fetchFn();
            this.cache.set(key, {
                data,
                timestamp: Date.now()
            });
            return data;
        });
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
