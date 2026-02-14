import { Context, Next } from 'hono'

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceDomain(htmlString: string, tagName: string, attrName: string, origin: string, target: string) {
    const escapedOrigin = escapeRegExp(origin);
    // 只匹配 a 标签中的 href 属性
    const regex = new RegExp('<' + tagName + '[^>]*?\\s*' + attrName + '\\s*=\\s*(["\\\'])(https?:\\/\\/)' + escapedOrigin + '([^"\\\']*)\\1[^>]*>', 'gi');

    return htmlString.replace(regex, function (match: string, quote: string, protocol: string, path: string) {
        return match.replace(
            new RegExp(attrName + '\\s*=\\s*(["\\\'])(https?:\\/\\/)' + escapedOrigin + '([^"\\\']*)\\1', 'i'),
            attrName + '=' + quote + protocol + target + path + quote
        );
    });
}

function convertLink(htmlString: string, origin: string, target: string) {
    htmlString = replaceDomain(htmlString, 'a', 'href', origin, target)
    htmlString = replaceDomain(htmlString, 'img', 'src', origin, target)
    htmlString = replaceDomain(htmlString, 'link', 'href', origin, target)
    htmlString = replaceDomain(htmlString, 'script', 'src', origin, target)
    return htmlString
}

const convertLinkMiddleware = (list: { origin: string, target: string }[]) => {
    return async (c: Context, next: Next) => {
        await next();
        const res = c.res.clone()
        const body = res.body
        let bodyText = ''
        if (body && res.headers.get('content-type')?.includes('text/html')) {
            bodyText = await res.text()
            list.forEach((item) => {
                if (item.target === 'HOST') item.target = c.req.header('host') || '';
                bodyText = convertLink(bodyText, item.origin, item.target)
            })
            c.res = new Response(bodyText, res)
        }
    }
}

export default convertLinkMiddleware