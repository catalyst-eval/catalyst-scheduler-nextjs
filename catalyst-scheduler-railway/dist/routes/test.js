"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/test.ts
const express_1 = require("express");
const sheets_1 = __importDefault(require("../lib/google/sheets"));
const router = (0, express_1.Router)();
// Cast to the interface to ensure TypeScript recognizes the methods
const sheetsService = new sheets_1.default();
router.get('/test-sheets', async (req, res) => {
    try {
        // Now TypeScript knows this method exists
        const data = await sheetsService.getOffices();
        res.json({
            success: true,
            data
        });
    }
    catch (error) {
        console.error('Test sheets error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
exports.default = router;
