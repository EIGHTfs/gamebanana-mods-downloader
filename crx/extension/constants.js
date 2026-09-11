"use strict";

// GameBanana API 基础 URL
const GB_API_BASE = "https://gamebanana.com/apiv11";
const GB_MOD_API = GB_API_BASE + "/Mod";
const GB_SEARCH_API = GB_API_BASE + "/Util/Search/Results";
const GB_DOWNLOAD_BASE = "https://gamebanana.com/dl/";

// HTTP 头
const CONTENT_TYPE_JSON = "application/json";
const ACCEPT_JSON = "application/json";

// 超时设置（毫秒）
const FETCH_TIMEOUT_MS = 30000;
const NATIVE_TIMEOUT_MS = 1500;

// 搜索参数
const SEARCH_PAGE_SIZE = 20;
const SEARCH_ORDER = "best_match";

// 默认设置
const DEFAULT_SETTINGS = {
  downloadMode: "browser",
  serverUrl: "",
  serverPassword: "",
  serverList: [],
  sessionCookie: "",
  aria2Path: "",
  aria2Token: "",
  nativeDownloadPath: "",
  concurrency: 4,
  toggles: { files: true, images: true }
};

// 下载模式
const DOWNLOAD_MODES = ["browser", "native", "server", "aria2"];

// 任务状态
const TASK_STATES = {
  SUBMITTED: "submitted",
  DONE: "done",
  SKIPPED: "skipped",
  ERROR: "error"
};

// Native Host 名称
const NATIVE_HOST = "com.gamebanana.mods.downloader.host";

// 导出（ES Module 语法，但 Chrome 扩展用全局变量）
if (typeof globalThis !== "undefined") {
  globalThis.GB_API_BASE = GB_API_BASE;
  globalThis.GB_MOD_API = GB_MOD_API;
  globalThis.GB_SEARCH_API = GB_SEARCH_API;
  globalThis.GB_DOWNLOAD_BASE = GB_DOWNLOAD_BASE;
  globalThis.CONTENT_TYPE_JSON = CONTENT_TYPE_JSON;
  globalThis.ACCEPT_JSON = ACCEPT_JSON;
  globalThis.FETCH_TIMEOUT_MS = FETCH_TIMEOUT_MS;
  globalThis.NATIVE_TIMEOUT_MS = NATIVE_TIMEOUT_MS;
  globalThis.SEARCH_PAGE_SIZE = SEARCH_PAGE_SIZE;
  globalThis.SEARCH_ORDER = SEARCH_ORDER;
  globalThis.DEFAULT_SETTINGS = DEFAULT_SETTINGS;
  globalThis.DOWNLOAD_MODES = DOWNLOAD_MODES;
  globalThis.TASK_STATES = TASK_STATES;
  globalThis.NATIVE_HOST = NATIVE_HOST;
}
