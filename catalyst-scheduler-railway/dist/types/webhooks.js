"use strict";
// src/types/webhooks.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebhookError = void 0;
class WebhookError extends Error {
    constructor(message, statusCode = 500, details) {
        super(message);
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'WebhookError';
    }
}
exports.WebhookError = WebhookError;
