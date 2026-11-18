import {h,render} from '../../../web/src/vendor/preact-htm.js';
import {McpSection} from '../../../web/src/components/settings/mcp.js';
import {OptimizerSection} from '../../../web/src/components/settings/optimizer.js';
const section=new URLSearchParams(location.search).get('section');
render(h(section==='optimizer'?OptimizerSection:McpSection,{}),document.getElementById('root'));
