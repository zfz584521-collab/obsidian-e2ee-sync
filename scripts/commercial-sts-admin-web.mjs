import crypto from 'node:crypto';

const MAX_BODY_BYTES = 16 * 1024;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOGIN_LIMIT = 5;

export function createCommercialAdminPortal({
  config,
  store,
  generateToken = () => crypto.randomBytes(32).toString('base64url'),
  now = () => Date.now(),
} = {}) {
  const sessions = new Map();
  const loginAttempts = new Map();

  return {
    async handle(request, response) {
      if (!config?.admin?.enabled) return false;
      const url = new URL(request.url || '/', 'http://localhost');
      if (!url.pathname.startsWith('/admin')) return false;

      if (request.method === 'GET' && (url.pathname === '/admin' || url.pathname === '/admin/')) {
        sendHtml(response, ADMIN_HTML);
        return true;
      }

      if (request.method === 'POST' && url.pathname === '/admin/api/login') {
        const address = request.socket?.remoteAddress || 'unknown';
        if (!allowLoginAttempt(loginAttempts, address, now())) {
          sendJson(response, 429, { message: '登录尝试过多，请稍后再试' });
          return true;
        }
        const body = await readJson(request, response);
        if (!body) return true;
        if (!safeEqual(String(body.password || ''), config.admin.password)) {
          sendJson(response, 401, { message: '管理员密码错误' });
          return true;
        }
        loginAttempts.delete(address);
        const sessionId = crypto.randomBytes(32).toString('base64url');
        const csrfToken = crypto.randomBytes(24).toString('base64url');
        const expiresAt = now() + config.admin.sessionTtlMs;
        sessions.set(sessionId, { csrfToken, expiresAt });
        sendJson(response, 200, { csrfToken, expiresAt }, {
          'set-cookie': sessionCookie(sessionId, config.admin.sessionTtlMs),
        });
        return true;
      }

      const session = authenticate(request, sessions, now());
      if (!session) {
        sendJson(response, 401, { message: '请先登录管理员页面' });
        return true;
      }

      if (request.method === 'GET' && url.pathname === '/admin/api/users') {
        sendJson(response, 200, { users: listCustomerSummaries(store, now()) });
        return true;
      }

      if (request.method === 'POST' && url.pathname === '/admin/api/users') {
        if (!verifyCsrf(request, session)) {
          sendJson(response, 403, { message: '页面验证已失效，请刷新后重试' });
          return true;
        }
        const body = await readJson(request, response);
        if (!body) return true;
        const input = validateCreateInput(body);
        if (!input.ok) {
          sendJson(response, 400, { message: input.message });
          return true;
        }
        if (store.getUser(input.userId)) {
          sendJson(response, 409, { message: '客户编号已存在' });
          return true;
        }
        store.addUser({
          id: input.userId,
          status: 'active',
          plan: input.plan,
          maxDevices: input.maxDevices,
        });
        const issued = issueSingleActiveToken({
          store,
          userId: input.userId,
          expiresInDays: input.expiresInDays,
          generateToken,
          now: now(),
        });
        sendJson(response, 201, {
          user: getCustomerSummary(store, input.userId, now()),
          token: issued.token,
          tokenExpiresAt: issued.expiresAt,
          displayOnce: true,
        });
        return true;
      }

      const reissueMatch = url.pathname.match(/^\/admin\/api\/users\/([a-zA-Z0-9_-]+)\/token$/);
      if (request.method === 'POST' && reissueMatch) {
        if (!verifyCsrf(request, session)) {
          sendJson(response, 403, { message: '页面验证已失效，请刷新后重试' });
          return true;
        }
        const userId = reissueMatch[1];
        if (!store.getUser(userId)) {
          sendJson(response, 404, { message: '客户不存在' });
          return true;
        }
        const body = await readJson(request, response);
        if (!body) return true;
        const expiresInDays = parseInteger(body.expiresInDays, 1, 3650);
        if (!expiresInDays) {
          sendJson(response, 400, { message: '有效天数必须是 1 到 3650 的整数' });
          return true;
        }
        const issued = issueSingleActiveToken({
          store,
          userId,
          expiresInDays,
          generateToken,
          now: now(),
        });
        sendJson(response, 200, {
          user: getCustomerSummary(store, userId, now()),
          token: issued.token,
          tokenExpiresAt: issued.expiresAt,
          displayOnce: true,
        });
        return true;
      }

      const extendMatch = url.pathname.match(/^\/admin\/api\/users\/([a-zA-Z0-9_-]+)\/token\/extend$/);
      if (request.method === 'POST' && extendMatch) {
        if (!verifyCsrf(request, session)) {
          sendJson(response, 403, { message: '页面验证已失效，请刷新后重试' });
          return true;
        }
        const userId = extendMatch[1];
        if (!store.getUser(userId)) {
          sendJson(response, 404, { message: '客户不存在' });
          return true;
        }
        const body = await readJson(request, response);
        if (!body) return true;
        const expiresInDays = parseInteger(body.expiresInDays, 1, 3650);
        if (!expiresInDays) {
          sendJson(response, 400, { message: '有效天数必须是 1 到 3650 的整数' });
          return true;
        }
        const activeToken = store.listTokens(userId).find(token => token.status === 'active');
        if (!activeToken) {
          sendJson(response, 409, { message: '该客户当前没有可续期的有效令牌' });
          return true;
        }
        const tokenExpiresAt = new Date(now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
        store.extendTokenByHash(activeToken.tokenHash, tokenExpiresAt);
        sendJson(response, 200, {
          user: getCustomerSummary(store, userId, now()),
          tokenExpiresAt,
        });
        return true;
      }

      const revokeMatch = url.pathname.match(/^\/admin\/api\/users\/([a-zA-Z0-9_-]+)\/token\/revoke$/);
      if (request.method === 'POST' && revokeMatch) {
        if (!verifyCsrf(request, session)) {
          sendJson(response, 403, { message: '页面验证已失效，请刷新后重试' });
          return true;
        }
        const userId = revokeMatch[1];
        if (!store.getUser(userId)) {
          sendJson(response, 404, { message: '客户不存在' });
          return true;
        }
        let revoked = 0;
        for (const token of store.listTokens(userId)) {
          if (token.status === 'active' && store.setTokenStatusByHash(token.tokenHash, 'revoked')) revoked++;
        }
        sendJson(response, 200, {
          user: getCustomerSummary(store, userId, now()),
          revoked,
        });
        return true;
      }

      const statusMatch = url.pathname.match(/^\/admin\/api\/users\/([a-zA-Z0-9_-]+)\/status$/);
      if (request.method === 'POST' && statusMatch) {
        if (!verifyCsrf(request, session)) {
          sendJson(response, 403, { message: '页面验证已失效，请刷新后重试' });
          return true;
        }
        const userId = statusMatch[1];
        const body = await readJson(request, response);
        if (!body) return true;
        if (!['active', 'disabled'].includes(body.status)) {
          sendJson(response, 400, { message: '客户状态无效' });
          return true;
        }
        if (!store.setUserStatus(userId, body.status)) {
          sendJson(response, 404, { message: '客户不存在' });
          return true;
        }
        sendJson(response, 200, { user: getCustomerSummary(store, userId, now()) });
        return true;
      }

      sendJson(response, 404, { message: 'not found' });
      return true;
    },
  };
}

function issueSingleActiveToken({ store, userId, expiresInDays, generateToken, now }) {
  for (const token of store.listTokens(userId)) {
    if (token.status === 'active') store.setTokenStatusByHash(token.tokenHash, 'revoked');
  }
  const token = generateToken();
  const expiresAt = new Date(now + expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  store.addToken({ token, userId, status: 'active', expiresAt });
  return { token, expiresAt };
}

function listCustomerSummaries(store, now) {
  return store.listUsers({ limit: 500 }).map(user => ({
    ...user,
    tokens: summarizeTokens(store.listTokens(user.userId), now),
  }));
}

function getCustomerSummary(store, userId, now) {
  return listCustomerSummaries(store, now).find(user => user.userId === userId);
}

function summarizeTokens(tokens, now) {
  const summary = { active: 0, expired: 0, revoked: 0, total: tokens.length, expiresAt: null };
  for (const token of tokens) {
    const expired = token.expiresAt && Date.parse(token.expiresAt) <= now;
    if (token.status === 'revoked') summary.revoked++;
    else if (expired) summary.expired++;
    else if (token.status === 'active') {
      summary.active++;
      summary.expiresAt = token.expiresAt || null;
    }
  }
  return summary;
}

function validateCreateInput(body) {
  const userId = String(body.userId || '').trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(userId)) {
    return { ok: false, message: '客户编号需为 3 到 64 位字母、数字、下划线或短横线' };
  }
  const maxDevices = parseInteger(body.maxDevices, 1, 50);
  if (!maxDevices) return { ok: false, message: '设备数量必须是 1 到 50 的整数' };
  const expiresInDays = parseInteger(body.expiresInDays, 1, 3650);
  if (!expiresInDays) return { ok: false, message: '有效天数必须是 1 到 3650 的整数' };
  const plan = ['starter', 'pro', 'team'].includes(body.plan) ? body.plan : 'starter';
  return { ok: true, userId, maxDevices, expiresInDays, plan };
}

function parseInteger(value, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function allowLoginAttempt(entries, key, timestamp) {
  const current = entries.get(key);
  if (!current || timestamp - current.startedAt >= LOGIN_WINDOW_MS) {
    entries.set(key, { startedAt: timestamp, count: 1 });
    return true;
  }
  current.count++;
  return current.count <= LOGIN_LIMIT;
}

function authenticate(request, sessions, timestamp) {
  const cookies = parseCookies(request.headers.cookie || '');
  const sessionId = cookies.commercial_sts_admin;
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session || session.expiresAt <= timestamp) {
    if (sessionId) sessions.delete(sessionId);
    return null;
  }
  return session;
}

function verifyCsrf(request, session) {
  return safeEqual(String(request.headers['x-csrf-token'] || ''), session.csrfToken);
}

function parseCookies(value) {
  return Object.fromEntries(String(value).split(';').map(part => {
    const index = part.indexOf('=');
    if (index < 0) return ['', ''];
    return [part.slice(0, index).trim(), part.slice(index + 1).trim()];
  }).filter(([key]) => key));
}

function safeEqual(left, right) {
  const leftHash = crypto.createHash('sha256').update(String(left)).digest();
  const rightHash = crypto.createHash('sha256').update(String(right)).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function sessionCookie(sessionId, ttlMs) {
  return `commercial_sts_admin=${sessionId}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.floor(ttlMs / 1000)}`;
}

async function readJson(request, response) {
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, { message: '请求必须使用 JSON' });
    return null;
  }
  let body = '';
  let bytes = 0;
  try {
    for await (const chunk of request) {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        sendJson(response, 413, { message: '请求体过大' });
        return null;
      }
      body += chunk;
    }
    return JSON.parse(body || '{}');
  } catch {
    sendJson(response, 400, { message: '请求体不是合法 JSON' });
    return null;
  }
}

function sendHtml(response, html) {
  response.writeHead(200, adminHeaders('text/html; charset=utf-8'));
  response.end(html);
}

function sendJson(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { ...adminHeaders('application/json; charset=utf-8'), ...extraHeaders });
  response.end(JSON.stringify(body));
}

function adminHeaders(contentType) {
  return {
    'content-type': contentType,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  };
}

const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>客户授权中心</title>
  <style>
    :root{color-scheme:light;--ink:#15231d;--muted:#65736d;--paper:#f4f1e9;--panel:#fffdf8;--line:#d8d3c7;--green:#174f3d;--accent:#df6c3c;--danger:#a33b32;--shadow:0 18px 48px rgba(38,48,43,.12)}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:"Noto Sans SC","Microsoft YaHei",sans-serif}button,input,select{font:inherit}.shell{min-height:100vh;display:grid;grid-template-columns:280px 1fr}.rail{background:var(--green);color:#f8f2e7;padding:36px 28px}.brand{font:700 25px Georgia,"Songti SC",serif;letter-spacing:.04em}.rail p{color:#c9d7d1;line-height:1.7}.main{padding:52px clamp(24px,5vw,72px)}.eyebrow{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:800}h1{font:700 clamp(34px,5vw,62px)/1.04 Georgia,"Songti SC",serif;margin:10px 0 14px}.lede{color:var(--muted);max-width:720px;line-height:1.7}.panel{margin-top:28px;background:var(--panel);border:1px solid var(--line);box-shadow:var(--shadow);padding:28px}.grid{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:14px}.field{display:grid;gap:8px}.field label{font-size:13px;font-weight:700}.field input,.field select{width:100%;border:1px solid var(--line);background:white;padding:12px 13px;outline:none}.field input:focus,.field select:focus{border-color:var(--green);box-shadow:0 0 0 3px rgba(23,79,61,.12)}button{border:0;padding:12px 18px;font-weight:800;cursor:pointer}.primary{background:var(--accent);color:white}.secondary{background:#e6ece8;color:var(--green)}.danger{background:#f3dfdc;color:var(--danger)}.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:18px}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:960px}th,td{text-align:left;padding:14px 12px;border-bottom:1px solid var(--line)}th{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}.status{font-weight:800;color:var(--green)}.actions{display:flex;gap:8px;flex-wrap:wrap}.actions button{padding:8px 10px;font-size:12px}.notice{margin-top:14px;color:var(--muted)}.token{margin-top:18px;border:2px solid var(--accent);padding:18px;background:#fff8ef}.token code{display:block;overflow-wrap:anywhere;font:700 15px ui-monospace,Consolas,monospace;margin:12px 0}.hidden{display:none!important}.login{max-width:520px}.login .field{margin:22px 0}.danger-note{color:var(--danger);font-weight:700}@media(max-width:850px){.shell{display:block}.rail{padding:24px}.main{padding:30px 18px}.grid{grid-template-columns:1fr 1fr}}@media(max-width:560px){.grid{grid-template-columns:1fr}.toolbar{align-items:flex-start;flex-direction:column}}
  </style>
</head>
<body>
  <div class="shell">
    <aside class="rail"><div class="brand">E2Note · Admin</div><p>客户、设备额度与授权令牌集中管理。原始令牌只在签发当下显示一次。</p></aside>
    <main class="main">
      <section id="loginView" class="panel login">
        <div class="eyebrow">Secure access</div><h1>客户授权中心</h1><p class="lede">使用服务器管理员密码登录。密码和客户令牌不会写入浏览器日志。</p>
        <form id="loginForm"><div class="field"><label for="password">管理员密码</label><input id="password" type="password" autocomplete="current-password" required></div><button class="primary" type="submit">登录</button></form>
        <p id="loginMessage" class="notice" role="status"></p>
      </section>
      <section id="appView" class="hidden">
        <div class="eyebrow">Commercial STS</div><h1>一键签发，清楚可控</h1><p class="lede">每位客户保留一个当前有效令牌，多台设备共用该令牌和同一同步密码。</p>
        <section class="panel"><div class="toolbar"><div><strong>新建客户并签发</strong><div class="notice">创建后立即复制，关闭提示后无法再次查看原文。</div></div></div>
          <form id="createForm" class="grid"><div class="field"><label for="userId">客户编号</label><input id="userId" placeholder="customer_001" required></div><div class="field"><label for="maxDevices">设备上限</label><input id="maxDevices" type="number" min="1" max="50" value="3" required></div><div class="field"><label for="expiresInDays">有效天数</label><input id="expiresInDays" type="number" min="1" max="3650" value="365" required></div><div class="field"><label>&nbsp;</label><button class="primary" type="submit">创建并签发</button></div></form>
          <div id="tokenBox" class="token hidden"><strong>令牌只显示这一次</strong><code id="tokenValue"></code><button id="copyToken" class="secondary" type="button">复制令牌</button><p class="danger-note">交付客户后请关闭此提示，不要截图或发送到公开聊天。</p></div><p id="actionMessage" class="notice" role="status"></p>
        </section>
        <section class="panel"><div class="toolbar"><div><strong>客户列表</strong><div class="notice">这里只显示状态和数量，不显示令牌原文。</div></div><button id="refresh" class="secondary" type="button">刷新</button></div><div class="table-wrap"><table><thead><tr><th>客户</th><th>状态</th><th>设备</th><th>令牌</th><th>到期时间</th><th>操作</th></tr></thead><tbody id="users"></tbody></table></div></section>
      </section>
    </main>
  </div>
  <script>
    let csrfToken='';const $=id=>document.getElementById(id);async function api(path,options={}){const headers={'content-type':'application/json',...(options.headers||{})};if(csrfToken&&options.method&&options.method!=='GET')headers['x-csrf-token']=csrfToken;const response=await fetch(path,{...options,headers});const data=await response.json();if(!response.ok)throw new Error(data.message||'操作失败');return data}
    function showToken(token){$('tokenValue').textContent=token;$('tokenBox').classList.remove('hidden')}
    async function loadUsers(){const data=await api('/admin/api/users');$('users').innerHTML=data.users.map(user=>'<tr><td><strong>'+escapeHtml(user.userId)+'</strong></td><td class="status">'+escapeHtml(user.status)+'</td><td>'+user.deviceCount+' / '+user.maxDevices+'</td><td>'+user.tokens.active+' 个有效</td><td>'+(user.tokens.expiresAt?new Date(user.tokens.expiresAt).toLocaleDateString():'—')+'</td><td class="actions"><button class="secondary" data-action="reissue" data-user="'+escapeHtml(user.userId)+'">重新签发</button><button class="secondary" data-action="extend" data-user="'+escapeHtml(user.userId)+'">续期</button><button class="danger" data-action="revoke" data-user="'+escapeHtml(user.userId)+'">吊销</button><button class="secondary" data-action="status" data-status="'+(user.status==='active'?'disabled':'active')+'" data-user="'+escapeHtml(user.userId)+'">'+(user.status==='active'?'停用':'恢复')+'</button></td></tr>').join('')||'<tr><td colspan="6">暂无客户</td></tr>'}
    function escapeHtml(value){return String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[char]))}
    $('loginForm').addEventListener('submit',async event=>{event.preventDefault();try{const data=await api('/admin/api/login',{method:'POST',body:JSON.stringify({password:$('password').value})});csrfToken=data.csrfToken;$('loginView').classList.add('hidden');$('appView').classList.remove('hidden');$('password').value='';await loadUsers()}catch(error){$('loginMessage').textContent=error.message}})
    $('createForm').addEventListener('submit',async event=>{event.preventDefault();try{const data=await api('/admin/api/users',{method:'POST',body:JSON.stringify({userId:$('userId').value,maxDevices:Number($('maxDevices').value),expiresInDays:Number($('expiresInDays').value)})});showToken(data.token);$('actionMessage').textContent='客户已创建，令牌已签发。';await loadUsers()}catch(error){$('actionMessage').textContent=error.message}})
    $('users').addEventListener('click',async event=>{const button=event.target.closest('button[data-action]');if(!button)return;const userId=button.dataset.user,action=button.dataset.action,days=Number($('expiresInDays').value);try{if(action==='reissue'){if(!confirm('重新签发会让旧令牌立即失效，确认继续？'))return;const data=await api('/admin/api/users/'+encodeURIComponent(userId)+'/token',{method:'POST',body:JSON.stringify({expiresInDays:days})});showToken(data.token);$('actionMessage').textContent='新令牌已签发，旧令牌已失效。'}else if(action==='extend'){await api('/admin/api/users/'+encodeURIComponent(userId)+'/token/extend',{method:'POST',body:JSON.stringify({expiresInDays:days})});$('actionMessage').textContent='令牌有效期已更新。'}else if(action==='revoke'){if(!confirm('吊销后客户设备将立即无法获取同步凭证，确认继续？'))return;await api('/admin/api/users/'+encodeURIComponent(userId)+'/token/revoke',{method:'POST',body:'{}'});$('actionMessage').textContent='当前有效令牌已吊销。'}else if(action==='status'){await api('/admin/api/users/'+encodeURIComponent(userId)+'/status',{method:'POST',body:JSON.stringify({status:button.dataset.status})});$('actionMessage').textContent=button.dataset.status==='active'?'客户已恢复':'客户已停用'}await loadUsers()}catch(error){$('actionMessage').textContent=error.message}})
    $('copyToken').addEventListener('click',async()=>{await navigator.clipboard.writeText($('tokenValue').textContent);$('actionMessage').textContent='令牌已复制，请立即粘贴到客户的 Obsidian。'});$('refresh').addEventListener('click',loadUsers)
  </script>
</body></html>`;
