// 参考 hono https://github.com/honojs
// node_modules\hono\dist\utils\color.js
// node_modules\hono\dist\middleware\logger\index.js
import { getConnInfo } from '@hono/node-server/conninfo'

function getClientIP(c) {
  try {
    const { remote } = getConnInfo(c)
    let ip = remote?.address || 'unknown'
    
    // 处理IPv6映射的IPv4地址
    if (ip === '::1') {
      ip = '127.0.0.1'
    } else if (ip.startsWith('::ffff:')) {
      ip = ip.substring(7) // 提取IPv4部分
    }
    
    return ip
  } catch {
    return 'unknown'
  }
}

function getColorEnabled() {
  const { process, Deno } = globalThis
  const isNoColor = typeof Deno?.noColor === 'boolean' 
    ? Deno.noColor 
    : process !== void 0 
      ? 'NO_COLOR' in process?.env
      : false
  return !isNoColor
}

async function getColorEnabledAsync() {
  const { navigator } = globalThis
  const cfWorkers = 'cloudflare:workers'
  const isNoColor = navigator !== void 0 && navigator.userAgent === 'Cloudflare-Workers' 
    ? await (async () => {
        try {
          return 'NO_COLOR' in ((await import(cfWorkers)).env ?? {})
        } catch {
          return false
        }
      })()
    : !getColorEnabled()
  return !isNoColor
}

var humanize = (times) => {
  const [delimiter, separator] = [",", "."];
  const orderTimes = times.map((v) => v.replace(/(\d)(?=(\d\d\d)+(?!\d))/g, "$1" + delimiter));
  return orderTimes.join(separator);
};
var time = (start) => {
  const delta = Date.now() - start;
  return humanize([delta < 1e3 ? delta + "ms" : Math.round(delta / 1e3) + "s"]);
};
var colorStatus = async (status) => {
  const colorEnabled = await getColorEnabledAsync();
  if (colorEnabled) {
    switch (status / 100 | 0) {
      case 5:
        return `\x1B[31m${status}\x1B[0m`;
      case 4:
        return `\x1B[33m${status}\x1B[0m`;
      case 3:
        return `\x1B[36m${status}\x1B[0m`;
      case 2:
        return `\x1B[32m${status}\x1B[0m`;
    }
  }
  return `${status}`;
};
async function log(fn, prefix, method, path, status = 0, elapsed) {
  const out = prefix === "<--" /* Incoming */ ? `${prefix} ${method} ${path}` : `${prefix} ${method} ${path} ${await colorStatus(status)} ${elapsed}`;
  fn(out);
}
var logger = (fn = console.log) => {
  return async function logger2(c, next) {
    const { method, url } = c.req;
    const ip = getClientIP(c);
    const path = url.slice(url.indexOf("/", 8));
    await log(fn, "<--" /* Incoming */, ip, method, path);
    const start = Date.now();
    await next();
    await log(fn, "-->" /* Outgoing */, ip, method, path, c.res.status, time(start));
  };
};
export {
  logger
};
