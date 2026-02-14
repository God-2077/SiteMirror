// html-inject-middleware.js
const htmlInjectMiddleware = (
    INJECTED_HEAD_BEGIN = '',
    INJECTED_HEAD_END = '',
    INJECTED_BODY_BEGIN = '',
    INJECTED_BODY_END = '',
) => {

  return async (c, next) => {
    await next();

    if (!c.res || c.res.status !== 200) {
      return;
    }

    const contentType = c.res.headers.get('content-type') || '';

    if (!contentType.includes('text/html')) {
      return;
    }

    if (!INJECTED_HEAD_BEGIN && !INJECTED_HEAD_END &&
      !INJECTED_BODY_BEGIN && !INJECTED_BODY_END) {
      return;
    }

    try {
      const response = c.res.clone();
      const html = await response.text();

      let injectedHtml = html;
      let injectionLog = [];

      if (INJECTED_HEAD_BEGIN) {
        injectedHtml = injectedHtml.replace(
          /<head[^>]*>/i,
          (match) => `${match}${INJECTED_HEAD_BEGIN}`
        );
        injectionLog.push('HEAD_BEGIN');
      }

      if (INJECTED_HEAD_END) {
        injectedHtml = injectedHtml.replace(
          /<\/head>/i,
          `${INJECTED_HEAD_END}</head>`
        );
        injectionLog.push('HEAD_END');
      }

      if (INJECTED_BODY_BEGIN) {
        injectedHtml = injectedHtml.replace(
          /<body[^>]*>/i,
          (match) => `${match}${INJECTED_BODY_BEGIN}`
        );
        injectionLog.push('BODY_BEGIN');
      }

      if (INJECTED_BODY_END) {
        injectedHtml = injectedHtml.replace(
          /<\/body>/i,
          `${INJECTED_BODY_END}</body>`
        );
        injectionLog.push('BODY_END');
      }

      const newHeaders = new Headers(c.res.headers);

      if (newHeaders.has('content-length')) {
        newHeaders.delete('content-length');
      }

      newHeaders.set('X-HTML-Injected', 'true');
      newHeaders.set('X-Injection-Points', injectionLog.join(', '));

      c.res = new Response(injectedHtml, {
        status: c.res.status,
        statusText: c.res.statusText,
        headers: newHeaders,
      });


    } catch (error) {
      console.error('HTML injection error:', error);
      return;
    }
  };
};

export default htmlInjectMiddleware;