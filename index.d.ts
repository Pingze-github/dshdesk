/**
 * dshdesk host plugin types.
 *
 * The browser half is a self-contained `__ModuleLoader__` bundle; the host
 * exposes these routes on the DSH web server:
 *
 * - `GET  /dshdesk/capabilities`
 * - `POST /dshdesk/snapshot`
 * - `POST /dshdesk/pin`
 * - `POST /dshdesk/unpin`
 * - `GET  /dshdesk/window`
 */
export declare const name: 'dshdesk'
export declare const inject: readonly ['webServer']
export declare function apply(ctx: unknown): void
