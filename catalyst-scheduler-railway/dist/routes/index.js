"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/index.ts
const express_1 = __importDefault(require("express"));
const test_1 = __importDefault(require("./test"));
const webhooks_1 = __importDefault(require("./webhooks"));
const router = express_1.default.Router();
// Mount routes
router.use('/test', test_1.default);
router.use('/webhooks', webhooks_1.default);
exports.default = router;
