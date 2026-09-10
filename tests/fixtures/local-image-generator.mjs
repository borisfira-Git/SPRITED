import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';

const mode=process.argv[2],requestPath=process.argv[3];
if(mode==='timeout'){await new Promise(resolve=>setTimeout(resolve,5000));process.exit(0);}
if(mode==='failure')process.exit(7);
const request=JSON.parse(await readFile(requestPath,'utf8')),output=path.join(path.dirname(requestPath),'output.png');
if(mode==='invalid')await writeFile(output,'not an image');
else {const source=request.materialized_assets.current||request.materialized_assets.reference||request.materialized_assets.previous||request.materialized_assets.next;if(!source)throw Error('No materialized source asset');await writeFile(output,await readFile(path.join(path.dirname(requestPath),source)));}
process.stdout.write(JSON.stringify({success:true,output_file:'output.png',format:'png'}));
