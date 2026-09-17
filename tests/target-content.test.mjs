import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTargetContent } from '../scripts/target-content.mjs';

test('MGI product sections retain nested headings and exclude the privacy dialog',()=>{
 const html='<header>Menu</header><div class="productcont section"><div><h4>Sequencing and imaging instrument</h4></div></div><div class="productcont"><h3>Automation</h3><div>Sample processing</div></div><div><p>'+ 'Privacy policy unrelated to the product. '.repeat(12)+'</p></div>';
 const r=extractTargetContent(html,'https://www.mgi-tech.com/Proteomics-products-platforms/5.html');
 assert.equal(r.content,'Sequencing and imaging instrument Automation Sample processing');
 assert.equal(r.extractionMethod,'source-body-productcont');
 assert.notEqual(extractTargetContent(html,'https://example.org/').content,r.content);
});
test('procurement short paragraphs and tables are retained without site footer',()=>{
 const html='<div class="vF_detail_content"><p>Project status</p><div><table><tr><td>Cancelled</td></tr></table></div><p>Insufficient eligible bids</p></div><p>'+ 'Unrelated website footer and navigation. '.repeat(8)+'</p>';
 assert.equal(extractTargetContent(html,'https://www.ccgp.gov.cn/cggg/a.htm').content,'Project status Cancelled Insufficient eligible bids');
});
