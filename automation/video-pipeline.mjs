import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {encodeGif} from './gif-encoder.mjs';
import {downloadGeneratedVideo} from './video-provider.mjs';

const fromDataUrl=value=>Buffer.from(value.split(',',2)[1]||'', 'base64');
const crc32=buffer=>{let crc=0xffffffff;for(const byte of buffer){crc^=byte;for(let bit=0;bit<8;bit+=1)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;};
const u16=value=>{const out=Buffer.alloc(2);out.writeUInt16LE(value);return out;};
const u32=value=>{const out=Buffer.alloc(4);out.writeUInt32LE(value>>>0);return out;};
export function buildFramesZip(entries){let offset=0;const local=[],central=[];for(const {name,bytes} of entries){const file=Buffer.from(name),data=Buffer.from(bytes),crc=crc32(data),header=Buffer.concat([Buffer.from([0x50,0x4b,3,4,20,0,0,0,0,0,0,0,0,0]),u32(crc),u32(data.length),u32(data.length),u16(file.length),u16(0),file,data]);local.push(header);central.push(Buffer.concat([Buffer.from([0x50,0x4b,1,2,20,0,20,0,0,0,0,0,0,0,0,0]),u32(crc),u32(data.length),u32(data.length),u16(file.length),u16(0),u16(0),u16(0),u16(0),u32(0),u32(offset),file]));offset+=header.length;}const directory=Buffer.concat(central);return Buffer.concat([...local,directory,Buffer.from([0x50,0x4b,5,6,0,0,0,0]),u16(entries.length),u16(entries.length),u32(directory.length),u32(offset),u16(0)]);}

async function videoDuration(service){return service.page.evaluate(async()=>{const video=document.createElement('video');video.preload='metadata';video.src='http://sprited.local/source-video?metadata';await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('Generated video metadata could not be decoded'));});const duration=video.duration;video.remove();return duration;});}

export async function runVideoPipeline(service,args){
  const frames=args.frames||8,animationType=args.animation_type||'WALKING',folder=`exports/video-${randomUUID()}`;
  let sourcePath=args.video_path||null,providerResult=null;
  if(!sourcePath){
    if(!args.character_id)throw Error('character_id is required when generating a video');
    const character=await service.core('workflow/character/select',{id:args.character_id});
    const referencePath=await service.input(character.reference_image_path,['.png','.webp'],9*1024*1024);
    const referenceImage={bytes:await readFile(referencePath),mime_type:path.extname(referencePath).toLowerCase()==='.webp'?'image/webp':'image/png'};
    providerResult=await service.videoProvider.generateAnimation({prompt:args.prompt,referenceImage,frames,animationType});
    const downloaded=await downloadGeneratedVideo(providerResult);
    if(downloaded.sourcePath)sourcePath=downloaded.sourcePath;
    else {const target=path.join(await service.directory('.sprited/generated-videos'),`${randomUUID()}${downloaded.extension}`);await writeFile(target,downloaded.bytes,{flag:'wx'});sourcePath=path.relative(service.root,target);}
  }
  await service.execute('video/import',{path:sourcePath});
  const duration=Number(args.duration_seconds)||await videoDuration(service);if(!Number.isFinite(duration)||duration<=0)throw Error('Generated video has no usable duration');
  await service.execute('video/extract',{start:0,end:duration,frames,max_size:args.max_size||512});
  if((args.background_mode||'key')==='key')await service.execute('frames/remove-background',{color:args.background||'#00ff00',tolerance:args.tolerance??52,softness:args.softness??12});
  await service.execute('frames/normalize',{mode:args.alignment||'body'});
  const built=await service.execute('spritesheet/build',{folder,cols:args.cols||Math.min(frames,4),spacing:args.spacing||0});if(!built.success)throw Error(built.errors.join('; ')||'Sprite sheet build failed');
  const preview=await service.core('preview'),outputDir=path.dirname(built.output_paths[0]),gifPath=path.join(outputDir,'preview.gif'),zipPath=path.join(outputDir,'frames.zip');
  await writeFile(gifPath,encodeGif(preview,{frame_duration_ms:Math.round(1000/(args.fps||12)),loop:true}),{flag:'wx'});
  await writeFile(zipPath,buildFramesZip(preview.frames.map((frame,index)=>({name:`frame_${String(index).padStart(3,'0')}.png`,bytes:fromDataUrl(frame.src)}))),{flag:'wx'});
  const output_paths=[...built.output_paths,gifPath,zipPath];
  const result={provider:providerResult?.provider||'uploaded_video',provider_job_id:providerResult?.job_id||null,character_id:args.character_id||null,animation_type:animationType,frame_count:preview.frames.length,source_video:service.manifest.source_video,output_paths,artifacts:{spritesheet_png:built.output_paths[0],metadata_json:built.output_paths[1],gif_preview:gifPath,frames_zip:zipPath}};
  if(args.character_id)await service.recordVideoGeneration({...result,prompt:args.prompt||null});
  return result;
}
