import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {envelope,failure} from './service.mjs';
import {configureMcpClient} from './client-config.mjs';
import {homedir} from 'node:os';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createMcpSession} from './mcp.mjs';
export async function serve(service,port=47821,token=process.env.SPRITED_TOKEN||randomBytes(32).toString('hex'),{clientHome=process.env.SPRITED_CLIENT_HOME||homedir()}={}) {
  const mcpSessions=new Map();
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
    const host=req.headers.host;
    const localHost=[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`].includes(host);
    const url=new URL(req.url,'http://127.0.0.1');
    const root=fileURLToPath(new URL('../',import.meta.url)),source=existsSync(path.join(root,'static/index.html'));
    const assets={'/ui/':[source?'public/shell.html':'app/shell.html','text/html'],'/ui/app.js':[source?'static/app.js':'app/app.js','text/javascript'],'/ui/style.css':[source?'app/globals.css':'app/style.css','text/css']};
    assets['/ui/editor.html']=[source?'static/index.html':'app/index.html','text/html'];assets['/ui/shell.css']=[source?'public/shell.css':'app/shell.css','text/css'];assets['/ui/editor-bridge.js']=[source?'public/editor-bridge.js':'app/editor-bridge.js','text/javascript'];
    for(const name of ['video-import','character-workflow','character-panel','library-panel'])assets[`/ui/${name}.js`]=[`${source?'public':'app'}/${name}.js`,'text/javascript'];
    if(localHost&&req.method==='GET'&&Object.hasOwn(assets,url.pathname)){try{const [file,type]=assets[url.pathname];res.setHeader('content-type',type);res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}return;}
    if((req.headers.origin&&req.headers.origin!==`http://${host}`) || !localHost || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)){
      res.writeHead(403);res.end(JSON.stringify(failure(new Error('Local token authentication required; browser origins are not accepted.'))));return;
    }
    try {
      if(url.pathname==='/mcp'){
        const sessionId=String(req.headers['mcp-session-id']||'');
        if(req.method==='DELETE'){const session=mcpSessions.get(sessionId);if(!session)throw Error('Unknown MCP session');await session.close();mcpSessions.delete(sessionId);res.writeHead(204);res.end();return;}
        if(req.method!=='POST'){res.setHeader('allow','POST, DELETE');res.writeHead(405);res.end(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Use MCP Streamable HTTP POST'}}));return;}
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw Error('MCP request too large');chunks.push(chunk);}const message=JSON.parse(Buffer.concat(chunks).toString()||'{}');
        let session=mcpSessions.get(sessionId),created=false;if(message.method==='initialize'&&!session){session=createMcpSession(service,{plugin:false});mcpSessions.set(session.sessionId,session);created=true;}if(!session)throw Error('Initialize an MCP session first');
        const reply=await session.handle(message);if(created)res.setHeader('mcp-session-id',session.sessionId);if(!reply){res.writeHead(202);res.end();return;}res.setHeader('content-type','application/json');res.end(JSON.stringify(reply));return;
      }
      if(url.pathname==='/connections/configure'&&req.method==='POST'){
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw Error('Request too large');chunks.push(chunk);}
        const body=JSON.parse(Buffer.concat(chunks).toString()||'{}'),result=await configureMcpClient({client:body.client,home:clientHome,command:process.execPath,cliPath:path.join(root,'automation','cli.mjs'),apiUrl:`http://${host}`,token});if(typeof service.selectExternalClient==='function')await service.selectExternalClient(body.client);res.end(JSON.stringify(envelope(result)));return;
      }
      if(url.pathname==='/identity'&&req.method==='GET'){res.end(JSON.stringify({application:'SPRITED',pid:process.pid,workspace:service.root,cli_path:path.join(root,'automation','cli.mjs')}));return;}
      if(url.pathname==='/ui/editor-project'&&req.method==='GET'){await service.tail;res.end(JSON.stringify(await service.core('snapshot')));return;}
      if(url.pathname==='/ui/artifact'&&req.method==='GET'){
        const requested=url.searchParams.get('path');if(!requested)throw Error('Artifact path is required');
        const file=await service.input(requested,['.png','.json','.gif','.zip','.spriteproject'],110*1024*1024),extension=path.extname(file).toLowerCase();
        const type={'.png':'image/png','.json':'application/json','.gif':'image/gif','.zip':'application/zip','.spriteproject':'application/json'}[extension]||'application/octet-stream';
        res.setHeader('content-type',type);res.setHeader('content-disposition',`attachment; filename="${path.basename(file)}"`);res.end(await readFile(file));return;
      }
      const asset=url.pathname.match(/^\/sheets\/([a-zA-Z0-9_-]+)\/asset\/(\d+)$/);
      if(asset&&req.method==='GET'){const r=await service.call('attempts/list');const sheet=r.result.flatMap(r=>r.spritesheets||[]).find(s=>s.id===asset[1]);const candidate=sheet?.output_paths[Number(asset[2])];if(!candidate)throw Error('Unknown sheet asset');const file=await service.input(candidate,['.png','.json','.spriteproject','.tres'],110*1024*1024);res.setHeader('content-type',file.endsWith('.png')?'image/png':'application/octet-stream');res.end(await readFile(file));return;}
      if(url.pathname==='/ui/reference'&&req.method==='POST'){
        if(!['image/png','image/webp'].includes(req.headers['content-type']))throw Error('PNG/WebP required');
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>9*1024*1024)throw Error('Reference too large');chunks.push(chunk);}
        const dir=await service.directory('.sprited/uploads'),file=path.join(dir,randomUUID()+(req.headers['content-type']==='image/png'?'.png':'.webp'));await writeFile(file,Buffer.concat(chunks),{flag:'wx'});
        const result=await service.call(url.searchParams.get('replace')?'character/replace-reference':'character/create',{path:file,name:url.searchParams.get('name')||'Character',...(url.searchParams.get('replace')?{id:url.searchParams.get('replace')}:{})});res.writeHead(result.success?200:400);res.end(JSON.stringify(result));return;
      }
      if(url.pathname==='/ui/assisted-import'&&req.method==='POST'){
        const format=req.headers['content-type']==='image/webp'?'webp':req.headers['content-type']==='image/png'?'png':null;if(!format)throw Error('PNG/WebP required');
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>9*1024*1024)throw Error('Frame image is too large');chunks.push(chunk);}
        const repairPlanId=url.searchParams.get('repair_plan_id'),frameIndex=Number(url.searchParams.get('frame_index')),animationId=url.searchParams.get('animation_id');
        const result=await service.call(repairPlanId?'agent/submit-repair-frame':'agent/submit-frame',{...(repairPlanId?{repair_plan_id:repairPlanId}:{animation_id:animationId}),frame_index:frameIndex,provider:'chatgpt_assisted',format,image_base64:Buffer.concat(chunks).toString('base64')});res.writeHead(result.success?200:400);res.end(JSON.stringify(result));return;
      }
      const media=url.pathname.match(/^\/attempts\/([a-zA-Z0-9_-]+)\/video$/);
      if(media&&req.method==='GET'){const r=await service.call('animation/status',{id:media[1]});if(!r.success||!r.result.source_video_path)throw Error('No video result');const file=await service.input(r.result.source_video_path,['.mp4','.webm','.mov'],250*1024*1024);res.setHeader('content-type',file.endsWith('.webm')?'video/webm':'video/mp4');res.end(await readFile(file));return;}
      const frame=url.pathname.match(/^\/attempts\/([a-zA-Z0-9_-]+)\/frames\/(\d+)$/);
      if(frame&&req.method==='GET'){const r=await service.call('animation/status',{id:frame[1]}),candidate=r.result?.source_frame_paths?.[Number(frame[2])];if(!r.success||!candidate)throw Error('No animation frame');const file=await service.input(candidate,['.png','.webp'],9*1024*1024);res.setHeader('content-type',file.endsWith('.webp')?'image/webp':'image/png');res.end(await readFile(file));return;}
      const gif=url.pathname.match(/^\/attempts\/([a-zA-Z0-9_-]+)\/preview\.gif$/);
      if(gif&&req.method==='GET'){const r=await service.call('animation/status',{id:gif[1]}),previewId=r.result?.current_preview_id;if(!r.success||!previewId)throw Error('No animation preview');if(url.searchParams.get('download')==='1'&&!r.result.user_approved)throw Error('Approve the animation before exporting its final GIF');const asset=await service.readContentReference(`preview:${previewId}`);res.setHeader('content-type','image/gif');if(url.searchParams.get('download')==='1')res.setHeader('content-disposition','attachment; filename="animation.gif"');res.end(asset.bytes);return;}
      const storedFrame=url.pathname.match(/^\/frames\/([a-zA-Z0-9_-]+)\/asset$/);
      if(storedFrame&&req.method==='GET'){const asset=await service.readContentReference(`frame:${storedFrame[1]}`);res.setHeader('content-type',asset.mime_type);res.end(asset.bytes);return;}
      const contentReference=url.pathname.match(/^\/content\/(character|frame|contact-sheet|preview)\/([a-zA-Z0-9_-]+)$/);
      if(contentReference&&req.method==='GET'){const asset=await service.readContentReference(`${contentReference[1]}:${contentReference[2]}`);res.setHeader('content-type',asset.mime_type);res.end(asset.bytes);return;}
      const route=new URL(req.url,'http://127.0.0.1').pathname.slice(1);
      const aliases={'character':'character/show','character/reference':'character/set-reference','recipes':'recipes/list','providers':'providers/list','characters':req.method==='GET'?'character/list':'character/create','generation-jobs':req.method==='GET'?'jobs/list':'jobs/create','attempts':'attempts/list','trash':'character/trash'};
      let action=Object.hasOwn(aliases,route)?aliases[route]:route;
      const run=route.match(/^(?:animation-runs|generation-runs)(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-z-]+))?$/);
      if(run)action=run[2]?'animation/'+run[2]:run[1]?'animation/status':req.method==='GET'?'animation/list':'animation/create';
      const jobRoute=route.match(/^generation-jobs\/([a-zA-Z0-9_-]+)(?:\/([a-z-]+))?$/);
      if(jobRoute)action='jobs/'+(jobRoute[2]||'get');
      if(req.method!==(['connections/status','connections/setup','plugin/status','activity/recent','activity/summary','status','frames/get','character/show','character/list','character/trash','jobs/list','jobs/get','attempts/list','recipes/list','providers/list','router/status','diagnostics/status','animation/list','animation/status','provider-policy/status'].includes(action)?'GET':'POST')){res.writeHead(405);res.end(JSON.stringify(failure(new Error('Method not allowed'))));return;}
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('Request too large');chunks.push(chunk);}
      const body=Buffer.concat(chunks).toString(),args=body?JSON.parse(body):{};
      if(req.method==='GET')for(const [key,value] of url.searchParams)args[key]=value;
      if(run?.[1])args.id=run[1];
      if(jobRoute)args.id=jobRoute[1];
      const result=await service.call(action,args);res.writeHead(result.success?200:400);res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400);res.end(JSON.stringify(failure(error)));}
  });
  server.on('close',()=>{for(const session of mcpSessions.values())session.close().catch(()=>{});mcpSessions.clear();});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,token,port:server.address().port};
}
