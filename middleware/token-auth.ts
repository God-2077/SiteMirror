import { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'

interface TokenAuthOptions {
  cookieName?: string
  token: string
  setupPageTitle?: string
}

export const tokenAuth = (options: TokenAuthOptions): MiddlewareHandler => {
  const {
    cookieName = 'access_token',
    token,
    setupPageTitle = '设置访问令牌'
  } = options

  return async (c, next) => {
    // 从cookie中获取令牌[2](@ref)
    const cookieToken = getCookie(c, cookieName)
    
    // 检查令牌是否匹配
    if (!!token && cookieToken == token) {
      // 令牌匹配，继续处理请求
      await next()
    } else {
      // 令牌不匹配，返回设置页面
      return c.html(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${setupPageTitle}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta charset="utf-8">
            <style>
                body { font-family: Arial, sans-serif; max-width: 500px; margin: 100px auto; padding: 20px; }
                .container { border: 1px solid #ddd; border-radius: 8px; padding: 30px; }
                input { width: 100%; padding: 10px; margin: 10px 0; border: 1px solid #ccc; border-radius: 4px; }
                button { background: #007acc; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; }
                button:hover { background: #005a9e; }
            </style>
        </head>
        <body>
            <div class="container">
                <h2>访问令牌设置</h2>
                <p>请设置有效的访问令牌以继续访问：</p>
                <form id="tokenForm">
                    <input type="text" id="tokenInput" placeholder="请输入访问令牌" required>
                    <button type="submit">设置令牌</button>
                </form>
            </div>
            <script>
                document.getElementById('tokenForm').addEventListener('submit', function(e) {
                    e.preventDefault();
                    const token = document.getElementById('tokenInput').value.trim();
                    if (token) {
                        // 设置cookie，有效期30天
                        document.cookie = '${cookieName}=' + token + '; max-age=${30 * 24 * 60 * 60}; path=/';
                        alert('令牌设置成功！');
                        window.location.reload();
                    }
                });
            </script>
        </body>
        </html>
      `,401)
    }
  }
}
