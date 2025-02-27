"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
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
router.get('/test-sheets', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Now TypeScript knows this method exists
        const data = yield sheetsService.getOffices();
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
}));
router.get('/test-sheets-meta', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Access the private sheets instance directly for this test
        const sheetsService = new sheets_1.default();
        const spreadsheetId = process.env.GOOGLE_SHEETS_SPREADSHEET_ID;
        const response = yield sheetsService.sheets.spreadsheets.get({
            spreadsheetId
        });
        res.json({
            success: true,
            sheets: response.data.sheets.map((sheet) => sheet.properties.title)
        });
    }
    catch (error) {
        console.error('Test sheets error:', error);
        res.status(500).json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
}));
exports.default = router;
