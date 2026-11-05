// Cloudflare Workers entry. Static files in /public are served by Workers Assets
// (e.g. /admin -> admin.html); only /api/* and /healthz reach this code.
import { createApp } from './app.js';

const d1 = (DB) => ({
  all: async (sql, params = []) => (await DB.prepare(sql).bind(...params.map((v) => v ?? null)).all()).results,
  get: async (sql, params = []) => (await DB.prepare(sql).bind(...params.map((v) => v ?? null)).first()) ?? null,
  run: async (sql, params = []) => ({ lastId: (await DB.prepare(sql).bind(...params.map((v) => v ?? null)).run()).meta.last_row_id }),
  batch: (sqls) => DB.batch(sqls.map((s) => DB.prepare(s))),
  // Runs one statement for many parameter sets in a single round trip
  runMany: (sql, rows) => (rows.length ? DB.batch(rows.map((params) => DB.prepare(sql).bind(...params.map((v) => v ?? null)))) : Promise.resolve([])),
});

let app;
export default {
  async fetch(request, env, ctx) {
    app ||= createApp({ db: d1(env.DB), timezone: env.APP_TIMEZONE || 'Asia/Taipei', adminPassword: env.ADMIN_PASSWORD });
    // Notifications are sent after the response, so approving or requesting feels instant.
    const res = await app.handle(request, { ip: request.headers.get('cf-connecting-ip') || 'unknown', defer: (p) => ctx.waitUntil(p) });
    return res || env.ASSETS.fetch(request);
  },
};
