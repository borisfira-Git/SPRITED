// Start a detached service with real log-file handles, never inherited launcher pipes.
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(process.argv[2]);const cli=fileURLToPath(new URL('cli.mjs',import.meta.url));
const out=openSync(path.join(root,'library-server.log'),'a'),err=openSync(path.join(root,'library-server-errors.log'),'a');
try{const child=spawn(process.execPath,[cli,'serve','--port','0','--workspace',root],{detached:true,windowsHide:true,stdio:['ignore',out,err]});await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});child.unref();process.stdout.write(String(child.pid));}finally{closeSync(out);closeSync(err);}
