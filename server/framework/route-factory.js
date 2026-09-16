// 路由工厂：把 handler 函数注册到 HTTP 路由
// 项目路由文件只需导出 handler 函数，框架处理：body 解析、错误捕获。
"use strict";

const { sendJson, readBody } = require("./http-utils");

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

function parseRouteTable(handlers) {
  const table = [];
  for (const [key, fn] of Object.entries(handlers)) {
    const parts = key.split(/\s+/);
    const method = parts[0].toUpperCase();
    const pattern = parts[1] || "/";
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    table.push({ method, re, fn });
  }
  return table;
}

async function parseBody(req) {
  if (!BODY_METHODS.has(req.method)) return;
  try { req.body = await readBody(req); }
  catch (_) { req.body = {}; }
}

/**
 * 创建路由处理器。
 * @param {object} handlers - { 'GET /path': fn, 'POST /path': fn, ... }
 */
function createRoute(handlers) {
  const table = parseRouteTable(handlers);

  return async function routeHandler(req, res, url, ctx) {
    const pathname = url.pathname;
    const method = req.method;

    for (const entry of table) {
      if (method !== entry.method) continue;
      const match = pathname.match(entry.re);
      if (!match) continue;

      await parseBody(req);
      req.params = match.groups || {};

      // 请求上下文：query / pathname / params / url（handler 第三参数直接取用）
      const reqCtx = Object.assign({}, ctx, {
        query: (url && url.query) || {},
        pathname: pathname,
        params: req.params,
        url: url,
        req: req,
        res: res,
      });

      try {
        await entry.fn(req, res, reqCtx);
      } catch (err) {
        console.error("[route] " + method + " " + pathname + " error:", err.message);
        sendJson(res, { ok: false, error: err.message || "内部错误" }, 500);
      }
      return true;
    }
    return false;
  };
}

/**
 * 创建路由组（多个路由合并）。
 */
function groupRoutes(...routes) {
  return async function(req, res, url, ctx) {
    for (const route of routes) {
      if (await route(req, res, url, ctx)) return true;
    }
    return false;
  };
}

module.exports = { createRoute, groupRoutes };
