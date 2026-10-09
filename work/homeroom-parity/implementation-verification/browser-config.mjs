import {existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export function browserConfig(url){
 const root=resolve(process.env.HH_REPO_ROOT||resolve(dirname(fileURLToPath(url)),'../../..'));
 const candidates=[resolve(root,'work/toolteam/browser'),resolve(root,'../toolteam/browser')];
 const cache=resolve(process.env.HH_BROWSER_CACHE||candidates.find(p=>existsSync(resolve(p,'node_modules/playwright/index.mjs')))||candidates[0]);
 const executable=resolve(process.env.HH_CHROMIUM_EXECUTABLE||resolve(cache,'browsers/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell'));
 const playwrightPath=resolve(process.env.HH_PLAYWRIGHT_MODULE||resolve(cache,'node_modules/playwright/index.mjs'));
 const libraries=['deps/usr/lib/x86_64-linux-gnu','deps/lib/x86_64-linux-gnu','deps/usr/lib','deps/lib'].map(p=>resolve(cache,p));
 return {root,builtRoot:resolve(root,process.env.HH_BUILT_ROOT||'checkpoint/dist/compiled/hh'),cache,playwrightPath,executable,launch:{executablePath:executable,headless:true,env:{...process.env,LD_LIBRARY_PATH:[...libraries,process.env.LD_LIBRARY_PATH||''].filter(Boolean).join(':')},args:['--no-sandbox','--disable-dev-shm-usage']},preview:(process.env.HH_PREVIEW_BASE_URL||'http://127.0.0.1:4188').replace(/\/$/,''),leaf:process.env.HH_PREVIEW_LEAF_URL,output:resolve(root,process.env.HH_VERIFY_OUTPUT||'outputs/homeroom-parity/implementation/verification')};
}
