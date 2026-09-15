import {createServer} from 'node:http';
import {createHash,createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {Service} from './service.mjs';
import {createMcpSession} from './mcp.mjs';

const port=Number(process.env.PORT||8080);
const host=process.env.HOST||'0.0.0.0';
const root=path.resolve(process.env.SPRITED_DATA_ROOT||'./data/chatgpt-app');
const remoteToken=process.env.SPRITED_REMOTE_TOKEN||'';
const configuredOrigin=String(process.env.SPRITED_PUBLIC_URL||'').replace(/\/$/,'');
if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT must be a valid TCP port');
if(!remoteToken)throw Error('SPRITED_REMOTE_TOKEN is required for the remote runtime');

await mkdir(root,{recursive:true});
const service=await new Service(root).init();
const sessions=new Map();
const authorizationCodes=new Map();

const safeEqual=(left,right)=>{const actual=Buffer.from(String(left||'')),expected=Buffer.from(String(right||''));return actual.length===expected.length&&timingSafeEqual(actual,expected);};
const requestOrigin=req=>configuredOrigin||`${String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim()}://${String(req.headers['x-forwarded-host']||req.headers.host||'').split(',')[0].trim()}`;
const resourceFor=req=>`${requestOrigin(req)}/mcp`;
const json=(res,status,body,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(JSON.stringify(body));};
const readBody=async(req,limit=64*1024)=>{let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks).toString();};
const base64url=value=>Buffer.from(value).toString('base64url');
const signToken=(type,resource,ttlSeconds)=>{const now=Math.floor(Date.now()/1000),payload=base64url(JSON.stringify({typ:type,sub:'sprited-owner',aud:resource,scope:'sprited:read sprited:write',iat:now,exp:now+ttlSeconds,jti:randomUUID()})),signature=createHmac('sha256',remoteToken).update(payload).digest('base64url');return `${payload}.${signature}`;};
const verifyToken=(token,resource,type='access')=>{try{const [payload,signature,extra]=String(token||'').split('.');if(!payload||!signature||extra)return false;const expected=createHmac('sha256',remoteToken).update(payload).digest('base64url');if(!safeEqual(signature,expected))return false;const claims=JSON.parse(Buffer.from(payload,'base64url').toString());return claims.typ===type&&claims.aud===resource&&claims.exp>Math.floor(Date.now()/1000);}catch{return false;}};
const bearer=req=>String(req.headers.authorization||'').match(/^Bearer\s+(.+)$/i)?.[1]||'';
const authorized=req=>{const token=bearer(req);return safeEqual(token,remoteToken)||verifyToken(token,resourceFor(req));};
const allowedRedirect=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='chatgpt.com'&&(url.pathname==='/connector_platform_oauth_redirect'||url.pathname.startsWith('/connector/oauth/'));}catch{return false;}};
const validClient=value=>String(value||'').startsWith('sprited-')||String(value||'').startsWith('https://chatgpt.com/oauth/');
const escapeHtml=value=>String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const oauthError=(res,status,error,description)=>json(res,status,{error,error_description:description},{'cache-control':'no-store'});
const scopeNames=value=>String(value||'').split(/\s+/).filter(Boolean).join(',')||'none';
const redirectLocation=value=>{try{const url=new URL(String(value||''));return `${url.host}${url.pathname}`;}catch{return 'none';}};
const captureOAuthFields=(details,params)=>{details.clientId=params.get('client_id')?'yes':'no';details.redirect=redirectLocation(params.get('redirect_uri'));details.scope=scopeNames(params.get('scope'));details.pkce=params.get('code_challenge_method')||'none';};
const auditRequest=(req,res,prefix,details)=>{res.once('finish',()=>console.log(`${prefix} method=${req.method} path=${new URL(req.url,'http://sprited.invalid').pathname} status=${res.statusCode} client_id=${details.clientId} redirect_uri=${details.redirect} scopes=${details.scope} pkce=${details.pkce} token_validation=${details.tokenValidation} mcp_stage=${details.mcpStage}`));return details;};

function validateAuthorization(params,req){
  const responseType=params.get('response_type'),clientId=params.get('client_id'),redirectUri=params.get('redirect_uri'),codeChallenge=params.get('code_challenge'),method=params.get('code_challenge_method'),resource=params.get('resource')||resourceFor(req);
  if(responseType!=='code')return {error:'Only response_type=code is supported'};
  if(!validClient(clientId))return {error:'Unsupported OAuth client'};
  if(!allowedRedirect(redirectUri))return {error:'Unsupported redirect URI'};
  if(method!=='S256'||!codeChallenge)return {error:'PKCE with S256 is required'};
  if(resource!==resourceFor(req))return {error:'Invalid resource'};
  return {clientId,redirectUri,codeChallenge,resource,state:params.get('state')||'',scope:params.get('scope')||'sprited:read sprited:write'};
}

function authorizationPage(values){
  const hidden=Object.entries(values).map(([name,value])=>`<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize SPRITED</title><style>body{font:16px system-ui;background:#111827;color:#f9fafb;display:grid;place-items:center;min-height:100vh;margin:0}.card{width:min(420px,calc(100% - 40px));background:#1f2937;padding:28px;border-radius:16px;box-shadow:0 20px 50px #0008}h1{margin-top:0}p{color:#cbd5e1;line-height:1.5}label{display:block;margin:22px 0 8px}input[type=password]{box-sizing:border-box;width:100%;padding:12px;border:1px solid #64748b;border-radius:8px;background:#0f172a;color:white}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:8px;background:#7c3aed;color:white;font-weight:700;cursor:pointer}</style></head><body><main class="card"><h1>Connect SPRITED</h1><p>Enter the private SPRITED access key stored in Render. ChatGPT will receive a limited OAuth token; the key itself is never sent to ChatGPT.</p><form method="post" action="/oauth/authorize">${hidden}<label for="access_key">SPRITED access key</label><input id="access_key" name="access_key" type="password" required autocomplete="current-password"><button type="submit">Authorize ChatGPT</button></form></main></body></html>`;
}

const server=createServer(async(req,res)=>{
  res.setHeader('cache-control','no-store');
  res.setHeader('access-control-allow-origin','https://chatgpt.com');
  res.setHeader('access-control-allow-headers','authorization,content-type,mcp-session-id');
  res.setHeader('access-control-expose-headers','mcp-session-id');
  if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
  const url=new URL(req.url,requestOrigin(req));
  const pathname=url.pathname;
  const origin=requestOrigin(req);
  const resource=resourceFor(req);
  const auditPrefix=pathname==='/.well-known/oauth-protected-resource'||pathname==='/.well-known/oauth-protected-resource/mcp'||pathname==='/.well-known/oauth-authorization-server'?'[OAUTH DISCOVERY]':pathname==='/oauth/register'?'[OAUTH REGISTER]':pathname==='/oauth/authorize'?'[OAUTH AUTHORIZE]':pathname==='/oauth/token'?'[OAUTH TOKEN]':pathname==='/mcp'?'[MCP]':null;
  const audit=auditPrefix?auditRequest(req,res,auditPrefix,{clientId:'no',redirect:'none',scope:'none',pkce:'none',tokenValidation:'no',mcpStage:'none'}):null;

  if(pathname==='/health'&&req.method==='GET')return json(res,200,{status:'ok',service:'sprited-chatgpt-app',version:'0.13.0-dev'});
  if(pathname==='/'&&req.method==='GET'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});return res.end('<!doctype html><html><head><meta charset="utf-8"><title>SPRITED</title></head><body><h1>SPRITED</h1><p>SPRITED MCP server is running.</p><p>Health: /health<br>MCP: /mcp</p></body></html>');}
  if((pathname==='/.well-known/oauth-protected-resource'||pathname==='/.well-known/oauth-protected-resource/mcp')&&req.method==='GET')return json(res,200,{resource,authorization_servers:[origin],scopes_supported:['sprited:read','sprited:write'],bearer_methods_supported:['header']});
  if(pathname==='/.well-known/oauth-authorization-server'&&req.method==='GET')return json(res,200,{issuer:origin,authorization_endpoint:`${origin}/oauth/authorize`,token_endpoint:`${origin}/oauth/token`,registration_endpoint:`${origin}/oauth/register`,authorization_response_iss_parameter_supported:true,response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['offline_access','sprited:read','sprited:write']});

  if(pathname==='/oauth/register'&&req.method==='POST'){
    try{const metadata=JSON.parse(await readBody(req));if(audit){audit.clientId=metadata.client_id?'yes':'no';audit.redirect=Array.isArray(metadata.redirect_uris)?metadata.redirect_uris.map(redirectLocation).join(',')||'none':'none';audit.scope=scopeNames(metadata.scope);}const redirects=Array.isArray(metadata.redirect_uris)?metadata.redirect_uris:[];if(!redirects.length||redirects.some(value=>!allowedRedirect(value)))return oauthError(res,400,'invalid_redirect_uri','Only ChatGPT callback URLs are accepted');const response=json(res,201,{...metadata,client_id:`sprited-${randomUUID()}`,client_id_issued_at:Math.floor(Date.now()/1000),token_endpoint_auth_method:'none'});if(audit)audit.tokenValidation='yes';return response;}catch(error){return oauthError(res,400,'invalid_client_metadata',error.message||'Invalid registration request');}
  }

  if(pathname==='/oauth/authorize'&&req.method==='GET'){
    if(audit)captureOAuthFields(audit,url.searchParams);const values=validateAuthorization(url.searchParams,req);if(values.error)return oauthError(res,400,'invalid_request',values.error);if(audit)audit.tokenValidation='yes';res.writeHead(200,{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});return res.end(authorizationPage({client_id:values.clientId,redirect_uri:values.redirectUri,code_challenge:values.codeChallenge,resource:values.resource,state:values.state,scope:values.scope}));
  }

  if(pathname==='/oauth/authorize'&&req.method==='POST'){
    try{const params=new URLSearchParams(await readBody(req)),validationParams=new URLSearchParams(Object.fromEntries(params));if(audit)captureOAuthFields(audit,params);validationParams.set('response_type','code');validationParams.set('code_challenge_method','S256');const values=validateAuthorization(validationParams,req);if(values.error)return oauthError(res,400,'invalid_request',values.error);if(!safeEqual(params.get('access_key'),remoteToken))return oauthError(res,401,'access_denied','The SPRITED access key is incorrect');const code=randomUUID();authorizationCodes.set(code,{...values,expiresAt:Date.now()+5*60*1000});const redirect=new URL(values.redirectUri);redirect.searchParams.set('code',code);if(values.state)redirect.searchParams.set('state',values.state);redirect.searchParams.set('iss',origin);console.log(`[OAUTH CALLBACK] redirect_host=${redirect.host} redirect_path=${redirect.pathname} has_code=yes has_state=${values.state?'yes':'no'} has_iss=yes has_error=no`);if(audit)audit.tokenValidation='yes';res.writeHead(302,{location:redirect.toString()});return res.end();}catch(error){return oauthError(res,400,'invalid_request',error.message||'Authorization failed');}
  }

  if(pathname==='/oauth/token'&&req.method==='POST'){
    try{const params=new URLSearchParams(await readBody(req)),grant=params.get('grant_type'),clientId=params.get('client_id');if(audit){audit.clientId=clientId?'yes':'no';audit.redirect=redirectLocation(params.get('redirect_uri'));audit.scope=scopeNames(params.get('scope'));}if(grant==='authorization_code'){const code=params.get('code'),record=authorizationCodes.get(code);authorizationCodes.delete(code);if(!record||record.expiresAt<Date.now())return oauthError(res,400,'invalid_grant','Authorization code is invalid or expired');if(clientId!==record.clientId||params.get('redirect_uri')!==record.redirectUri)return oauthError(res,400,'invalid_grant','OAuth client or redirect URI does not match');const actual=base64url(createHash('sha256').update(params.get('code_verifier')||'').digest());if(!safeEqual(actual,record.codeChallenge))return oauthError(res,400,'invalid_grant','PKCE verification failed');if(audit)audit.tokenValidation='yes';return json(res,200,{access_token:signToken('access',record.resource,3600),token_type:'Bearer',expires_in:3600,refresh_token:signToken('refresh',record.resource,30*24*3600),scope:record.scope});}if(grant==='refresh_token'){const refresh=params.get('refresh_token');if(!verifyToken(refresh,resource,'refresh'))return oauthError(res,400,'invalid_grant','Refresh token is invalid or expired');if(audit)audit.tokenValidation='yes';return json(res,200,{access_token:signToken('access',resource,3600),token_type:'Bearer',expires_in:3600,refresh_token:signToken('refresh',resource,30*24*3600),scope:'sprited:read sprited:write'});}return oauthError(res,400,'unsupported_grant_type','Unsupported grant type');}catch(error){return oauthError(res,400,'invalid_request',error.message||'Token request failed');}
  }

  if(pathname!=='/mcp'){res.writeHead(404);return res.end();}
  const tokenValid=authorized(req);if(audit)audit.tokenValidation=tokenValid?'yes':'no';if(!tokenValid){res.setHeader('www-authenticate',`Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource", scope="sprited:read sprited:write"`);return json(res,401,{error:'Authentication required'});}
  try{const sessionId=String(req.headers['mcp-session-id']||'');if(req.method==='DELETE'){if(audit)audit.mcpStage='delete';const session=sessions.get(sessionId);if(session){await session.close();sessions.delete(sessionId);}res.writeHead(204);return res.end();}if(req.method!=='POST'){res.writeHead(405);return res.end();}const message=JSON.parse(await readBody(req,13*1024*1024)||'{}');if(audit)audit.mcpStage=message.method==='initialize'?'initialize':message.method==='notifications/initialized'?'initialized':message.method==='tools/list'?'tools-list':'other';let session=sessions.get(sessionId),created=false;if(message.method==='initialize'&&!session){session=createMcpSession(service,{plugin:true});sessions.set(session.sessionId,session);created=true;}if(!session)throw Error('Initialize an MCP session first');const reply=await session.handle(message);if(created)res.setHeader('mcp-session-id',session.sessionId);res.setHeader('content-type','application/json');if(!reply){res.writeHead(202);return res.end();}res.end(JSON.stringify(reply));}catch(error){json(res,400,{jsonrpc:'2.0',id:null,error:{code:-32603,message:error.message||'Request failed'}});}
});

await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
console.log(`SPRITED ChatGPT App MCP listening on port ${port}`);
const stop=async()=>{server.close();for(const session of sessions.values())await session.close().catch(()=>{});await service.close();process.exit(0);};
process.on('SIGTERM',stop);
process.on('SIGINT',stop);
