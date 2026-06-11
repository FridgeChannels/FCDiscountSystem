// 统一调试日志开关:仅在开发模式(import.meta.env.DEV)输出,生产构建自动静默。
// 用 dbg / dbgError 替换散落在业务代码里的 console.log('[FCDBG]...') 调用。
const DEBUG =
  typeof import.meta !== 'undefined' &&
  import.meta.env &&
  import.meta.env.DEV;

export function dbg(...args) {
  if (DEBUG) console.log(...args);
}

export function dbgError(...args) {
  if (DEBUG) console.error(...args);
}
