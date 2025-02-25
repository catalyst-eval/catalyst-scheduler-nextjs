"use strict";
// src/types/scheduling.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.standardizeOfficeId = standardizeOfficeId;
// Utility function for standardizing office IDs
function standardizeOfficeId(officeId) {
    const cleaned = officeId.trim().toUpperCase();
    const match = cleaned.match(/^([A-Z])-?([A-Z])$/i);
    if (match) {
        return `${match[1]}-${match[2]}`;
    }
    return cleaned;
}
