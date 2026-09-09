import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {failure} from './service.mjs';
export async function serve(service,port=47821,token=process.env.SPRITED_TOKEN||randomBytes(32).toString('hex')) {
  const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');res.setHeader('cache-control','no-store');
    const supplied=Buffer.from(req.headers.authorization||''),expected=Buffer.from(`Bearer ${token}`);
    const host=req.headers.host;
    if(req.headers.origin || ![ `127.0.0.1:${server.address().port}`,`localhost:${server.address().port}`].includes(host) || supplied.length!==expected.length || !timingSafeEqual(supplied,expected)){
      res.writeHead(403);res.end(JSON.stringify(failure(new Error('Local token authentication required; browser origins are not accepted.'))));return;
    }
    try {
      const action=new URL(req.url,'http://127.0.0.1').pathname.slice(1);
      if(req.method!==(action==='status'||action==='frames/get'?'GET':'POST')){res.writeHead(405);res.end(JSON.stringify(failure(new Error('Method not allowed'))));return;}
      let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>65536)throw new Error('Request too large');chunks.push(chunk);}
      const body=Buffer.concat(chunks).toString(),args=body?JSON.parse(body):{};
      const result=await service.call(action,args);res.writeHead(result.success?200:400);res.end(JSON.stringify(result));
    }catch(error){res.writeHead(400);res.end(JSON.stringify(failure(error)));}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve)});
  return {server,token,port:server.address().port};
}
