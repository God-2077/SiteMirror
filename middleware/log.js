// 参考 hono https://github.com/honojs
// node_modules\hono\dist\utils\color.js
// node_modules\hono\dist\middleware\logger\index.js

import { getConnInfo } from '@hono/node-server/conninfo'

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

// 格式化时间戳
function formatTimestamp(date = new Date()) {
  const pad = (n, length = 2) => n.toString().padStart(length, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}


// 格式化时间差
const time = (start) => {
  const delta = Date.now() - start
  if (delta < 1000) return `${delta}ms`
  if (delta < 60000) return `${(delta / 1000).toFixed(2)}s`
  return `${(delta / 60000).toFixed(2)}m`
}

// 状态码颜色
const colorStatus = async (status) => {
  const colorEnabled = await getColorEnabledAsync()
  if (!colorEnabled) return `${status}`
  
  switch (Math.floor(status / 100)) {
    case 1: return `\x1b[36m${status}\x1b[0m` // 青色 1xx
    case 2: return `\x1b[32m${status}\x1b[0m` // 绿色 2xx
    case 3: return `\x1b[33m${status}\x1b[0m` // 黄色 3xx
    case 4: return `\x1b[35m${status}\x1b[0m` // 紫色 4xx
    case 5: return `\x1b[31m${status}\x1b[0m` // 红色 5xx
    default: return `${status}`
  }
}

// 方法颜色
const colorMethod = async (method) => {
  const colorEnabled = await getColorEnabledAsync()
  if (!colorEnabled) return method.padEnd(7)
  
  const colors = {
    GET: '\x1b[32m',     // 绿色
    POST: '\x1b[33m',    // 黄色
    PUT: '\x1b[34m',     // 蓝色
    DELETE: '\x1b[31m',  // 红色
    PATCH: '\x1b[36m',   // 青色
    HEAD: '\x1b[35m',    // 紫色
    TRACE: '\x1b[90m',   // 灰色
    OPTIONS: '\x1b[90m', // 灰色
  }
  
  const color = colors[method] || '\x1b[0m'
  return `${color}${method.padEnd(7)}\x1b[0m`
}

// 获取客户端IP
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

// 日志记录器
export const logger = (options = {}) => {
  const {
    // 默认日志函数
    logFn = console.log,
    // 是否记录请求开始
    logRequestStart = false,
    // 是否记录耗时
    logDuration = true,
    // 自定义日志格式
    formatter = null
  } = options
  
  return async function loggerMiddleware(c, next) {
    const startTime = Date.now()
    const timestamp = formatTimestamp()
    const clientIP = getClientIP(c)
    const { method } = c.req
    const { pathname, search } = new URL(c.req.url)
    const fullPath = search ? `${pathname}${search}` : pathname
    
    // 可选：记录请求开始
    if (logRequestStart) {
      const coloredMethod = await colorMethod(method)
      logFn(`[${timestamp}] ${clientIP.padEnd(15)} ${coloredMethod} ${fullPath}`)
    }
    
    try {
      await next()
      
      const duration = Date.now() - startTime
      const statusCode = c.res.status
      
      if (formatter) {
        // 使用自定义格式化
        logFn(formatter({
          timestamp,
          clientIP,
          method,
          path: fullPath,
          status: statusCode,
          duration
        }))
      } else {
        // 默认格式化
        const coloredMethod = await colorMethod(method)
        const coloredStatus = await colorStatus(statusCode)
        const durationStr = logDuration ? ` ${time(startTime)}` : ''
        
        logFn(`[${timestamp}] ${clientIP.padEnd(15)} ${coloredMethod} ${fullPath} ${coloredStatus}${durationStr}`)
      }
    } catch (error) {
      // 处理中间件错误
      const duration = Date.now() - startTime
      const coloredMethod = await colorMethod(method)
      const durationStr = logDuration ? ` ${time(startTime)}` : ''
      
      logFn(`[${timestamp}] ${clientIP.padEnd(15)} ${coloredMethod} ${fullPath} \x1b[31mERROR\x1b[0m${durationStr}`)
      throw error
    }
  }
}

// JSON格式日志（适用于结构化日志系统）
export const jsonLogger = (options = {}) => {
  const {
    logFn = (data) => console.log(JSON.stringify(data))
  } = options
  
  return async function jsonLoggerMiddleware(c, next) {
    const startTime = Date.now()
    const timestamp = new Date().toISOString()
    const clientIP = getClientIP(c)
    const { method } = c.req
    const { pathname, search } = new URL(c.req.url)
    const fullPath = search ? `${pathname}${search}` : pathname
    
    try {
      await next()
      
      const logData = {
        timestamp,
        clientIP,
        method,
        path: fullPath,
        status: c.res.status,
        duration: Date.now() - startTime,
        userAgent: c.req.header('user-agent') || null,
        referer: c.req.header('referer') || null
      }
      
      logFn(logData)
    } catch (error) {
      const logData = {
        timestamp,
        clientIP,
        method,
        path: fullPath,
        status: 500,
        duration: Date.now() - startTime,
        error: error.message
      }
      
      logFn(logData)
      throw error
    }
  }
}
