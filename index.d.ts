// Type definitions for index.js
// Project: Mirror Server
// Definitions by: Your Name

import { Hono } from 'hono';
import { Context } from 'hono/context';
import { Pool } from 'undici';
import { LRUCache } from 'lru-cache';

/**
 * Configuration constants
 */
export const PROTOCOL: string;
export const ORIGIN_SERVER: string;
export const PORT: number | string;
export const CACHE_TTL: number;
export const CACHE_CLEAR_TOKEN: string;
export const REQUEST_TIMEOUT: number;
export const MAX_CONNECTIONS: number;
export const MAX_KEEP_ALIVE_TIMEOUT: number;
export const CACHE_STRATEGY: 'off' | 'force' | 'auto';
export const CACHE_STATIC_ONLY: boolean;

/**
 * Connection pool for origin server
 */
export const originPool: Pool;

/**
 * Cache instance (null if cache is disabled)
 */
export const cache: LRUCache<string, any> | null;

/**
 * Static resource extensions list
 */
export const STATIC_EXTENSIONS: string[];

/**
 * Check if a resource is static based on path or content type
 */
export function isStaticResource(path?: string, contentType?: string): boolean;

/**
 * Determine if a response should be cached based on strategy
 */
export function shouldCacheResponse(path: string, contentType: string, cacheControl?: string): boolean;

/**
 * Middleware to safely add timing headers
 */
export function safeTiming(c: Context, next: () => Promise<void>): Promise<void>;

/**
 * Encode a path segment for URL safety
 */
export function encodePathSegment(segment: string): string;

/**
 * Encode a full path for URL safety
 */
export function encodePath(path: string): string;

/**
 * HTML injection middleware factory
 */
export function htmlInjectMiddleware(): (c: Context, next: () => Promise<void>) => Promise<void>;

/**
 * Static resource cache middleware
 */
export function staticCacheMiddleware(c: Context, next: () => Promise<void>): Promise<void>;

/**
 * Process request headers for proxying
 */
export function processHeaders(originalHeaders: Headers): Headers;

/**
 * Process response headers from origin server
 */
export function processResponseHeaders(originalHeaders: Headers | Record<string, string | string[]> | Map<string, string>): Headers;

/**
 * Fix redirect URLs to point to mirror instead of origin
 */
export function fixRedirectUrl(location: string, c: Context): string | null;

/**
 * Cleanup function for graceful shutdown
 */
export function cleanup(): Promise<void>;

/**
 * Main Hono application instance
 */
export const app: Hono;

export default app;
