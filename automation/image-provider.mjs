export class ImageProvider {
  async generate_frame(){throw new Error('Image provider must implement generate_frame');}
  async edit_frame(){throw new Error('Image provider must implement edit_frame');}
}

export class ExternalManualProvider extends ImageProvider {
  normalize({image_base64,format}){
    if(!['png','webp'].includes(format))throw new Error('Frame format must be png or webp');
    if(typeof image_base64!=='string'||!image_base64.length||image_base64.length>12*1024*1024)throw new Error('Frame image is missing or too large');
    const bytes=Buffer.from(image_base64,'base64');if(!bytes.length||bytes.length>9*1024*1024)throw new Error('Frame image is missing or too large');
    const png=bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp=bytes.length>=12&&bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
    if((format==='png'&&!png)||(format==='webp'&&!webp))throw new Error(`Submitted bytes are not a valid ${format.toUpperCase()} image`);
    return {bytes,format,mime_type:`image/${format}`,provider:'external_manual'};
  }
  async generate_frame(request){return this.normalize(request);}
  async edit_frame(request){return this.normalize(request);}
}
