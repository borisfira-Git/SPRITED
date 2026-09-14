const MODES=new Set(['sprited_only','codex_assist','manual']);
const ACTIONS=new Set(['regenerate','replace_or_align','regenerate_with_neighbors','edit_with_neighbors']);
const text=(value,max)=>typeof value==='string'?value.trim().slice(0,max):'';

export class CodexRepairSupervisor {
  constructor({mode='sprited_only',advisor=null,timeout_ms=15000}={}){if(!MODES.has(mode))throw Error('Unknown repair intelligence mode');this.mode=mode;this.advisor=advisor;this.timeout_ms=timeout_ms;}
  setMode(mode){if(!MODES.has(mode))throw Error('Unknown repair intelligence mode');this.mode=mode;}
  async suggest(context,fallback){if(this.mode!=='codex_assist'||typeof this.advisor!=='function')return {...fallback,strategy_source:'sprited',supervisor_used:false};let timeoutId;const timer=new Promise((_,reject)=>{timeoutId=setTimeout(()=>reject(Error('Codex Assist timed out')),this.timeout_ms);});try{const value=await Promise.race([this.advisor(structuredClone(context)),timer]);if(!value||typeof value!=='object'||!ACTIONS.has(value.recommended_strategy)||typeof value.confidence!=='number'||value.confidence<0||value.confidence>1)throw Error('Codex Assist returned invalid advice');return {issue_type:text(value.issue_type,100)||fallback.issue_type,recommended_strategy:value.recommended_strategy,repair_action:value.recommended_strategy,repair_instruction:text(value.repair_instruction,1200)||fallback.repair_instruction,use_previous_frame:value.use_previous_frame===true,use_next_frame:value.use_next_frame===true,confidence:value.confidence,strategy_source:'codex_assist',supervisor_used:true};}catch{return {...fallback,strategy_source:'sprited_fallback',supervisor_used:false,supervisor_warning:'Codex Assist unavailable; SPRITED continued automatically.'};}finally{clearTimeout(timeoutId);}}
}

export const repairIntelligenceModes=()=>['sprited_only','codex_assist','manual'];
