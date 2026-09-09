import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {failure} from './service.mjs';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
export async function serve(service,port=47821,token=process.env.SPRITED_TOKEN||randomBytes(32).toString('hex')) {
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
    const host=req.headers.host;
    const localHost=[`127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`].includes(host);
    const url=new URL(req.url,'http://127.0.0.1');
    const root=fileURLToPath(new URL('../',import.meta.url)),source=existsSync(path.join(root,'static/index.html'));
    const assets={'/ui/':[source?'static/index.html':'app/index.html','text/html'],'/ui/app.js':[source?'static/app.js':'app/app.js','text/javascript'],'/ui/style.css':[source?'app/globals.css':'app/style.css','text/css']};
    for(const name of ['video-import','character-workflow','character-panel','library-panel'])assets[`/ui/${name}.js`]=[`${source?'public':'app'}/${name}.js`,'text/javascript'];
    if(localHost&&req.method==='GET'&&Object.hasOwn(assets,url.pathname)){try{const [file,type]=assets[url.pathname];res.setHeader('content-type',type);res.end(await readFile(path.join(root,file)));}catch{res.writeHead(404);res.end();}return;}
    if((req.headers.origin&&req.headers.origin!==`http://${host}`) || !localHost || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)){
      res.writeHead(403);res.end(JSON.stringify(failure(new Error('Local token authentication required; browser origins are not accepted.'))));return;
    }
    try {
      if(url.pathname==='/ui/editor-project'&&req.method==='GET'){await service.tail;res.end(JSON.stringify(await service.core('snapshot')));return;}
      const asset=url.pathname.match(/^\/sheets\/([a-zA-Z0-9_-]+)\/asset\/(\d+)$/);
      if(asset&&req.method==='GET'){const r=await service.call('attempts/list');const sheet=r.result.flatMap(r=>r.spritesheets||[]).find(s=>s.id===asset[1]);const candidate=sheet?.output_paths[Number(asset[2])];if(!candidate)throw Error('Unknown sheet asset');const file=await service.input(candidate,['.png'],64*1024*1024);res.setHeader('content-type','image/png');res.end(await readFile(file));return;}
      if(url.pathname==='/ui/reference'&&req.method==='POST'){
        if(!['image/png','image/webp'].includes(req.headers['content-type']))throw Error('PNG/WebP required');
        let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>9*1024*1024)throw Error('Reference too large');chunks.push(chunk);}
        const dir=await service.directory('.sprited/uploads'),file=path.join(dir,randomUUID()+(req.headers['content-type']==='image/png'?'.png':'.webp'));await writeFile(file,Buffer.concat(chunks),{flag:'wx'});
        const result=await service.call('character/create',{path:file,name:url.searchParams.get('name')||'Character'});res.writeHead(result.success?200:400);res.end(JSON.stringify(result));return;
      }
      const media=url.pathname.match(/^\/attempts\/([a-zA-Z0-9_-]+)\/video$/);
      if(media&&req.method==='GET'){const r=await service.call('animation/status',{id:media[1]});if(!r.success||!r.result.source_video_path)throw Error('No video result');const file=await service.input(r.result.source_video_path,['.mp4','.webm','.mov'],250*1024*1024);res.setHeader('content-type',file.endsWith('.webm')?'video/webm':'video/mp4');res.end(await readFile(file));return;}
      const route=new URL(req.url,'http://127.0.0.1').pathname.slice(1);
      const aliases={'character':'character/show','character/reference':'character/set-reference','recipes':'recipes/list','providers':'providers/list','characters':req.method==='GET'?'character/list':'character/create','generation-jobs':req.method==='GET'?'jobs/list':'jobs/create','attempts':'attempts/list','trash':'character/trash'};
      let action=Object.hasOwn(aliases,route)?aliases[route]:route;
      const run=route.match(/^(?:animation-runs|generation-runs)(?:\/([a-zA-Z0-9_-]+))?(?:\/([a-z-]+))?$/);
      if(run)action=run[2]?'animation/'+run[2]:run[1]?'animation/status':req.method==='GET'?'animation/list':'animation/create';
      const jobRoute=route.match(/^generation-jobs\/([a-zA-Z0-9_-]+)(?:\/([a-z-]+))?$/);
      if(jobRoute)action='jobs/'+(jobRoute[2]||'get');
      if(req.method!==(['status','frames/get','character/show','character/list','character/trash','jobs/list','jobs/get','attempts/list','recipes/list','providers/list','router/status','diagnostics/status','animation/list','animation/status'].includes(action)?'GET':'POST')){res.writeHead(405);res.end(JSON.stringify(failure(new Error('Method not allowed'))));return;}
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('Request too large');chunks.push(chunk);}
      const body=Buffer.concat(chunks).toString(),args=body?JSON.parse(body):{};
      if(req.method==='GET')for(const [key,value] of url.searchParams)args[key]=value;
      if(run?.[1])args.id=run[1];
      if(jobRoute)args.id=jobRoute[1];
      const result=await service.call(action,args);res.writeHead(result.success?200:400);res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400);res.end(JSON.stringify(failure(error)));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,token,port:server.address().port};
}
