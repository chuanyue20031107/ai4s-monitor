import { clean, extractContent } from './pipeline.mjs';

// Restrict known layout adapters to their source hosts. Never execute downloaded scripts.
function divBodies(html, className) {
  const result = [], tags = [...html.matchAll(/<\/?div\b[^>]*>/gi)];
  for (let i=0;i<tags.length;i++) {
    const current=tags[i], cls=current[0].match(/\bclass\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    if (/^<\//.test(current[0]) || !cls.split(/\s+/).includes(className)) continue;
    let depth=1;
    for (let j=i+1;j<tags.length;j++) {
      depth += /^<\//.test(tags[j][0]) ? -1 : 1;
      if (!depth) { result.push(html.slice(current.index+current[0].length,tags[j].index)); i=j; break; }
    }
  }
  return result;
}
export function extractTargetContent(html, url) {
  const fallback=extractContent(html), host=new URL(url).hostname;
  const selector=host==='www.mgi-tech.com' ? 'productcont' : host==='www.ccgp.gov.cn' ? 'vF_detail_content' : '';
  if (!selector) return fallback;
  const content=clean(divBodies(html,selector).join(' '));
  return content ? {...fallback, content:content.slice(0,5000),contentTruncated:content.length>5000,
    extractionMethod:'source-body-'+selector} : fallback;
}
