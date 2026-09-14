import {readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const cleanText=(value,max=240)=>typeof value==='string'?value.trim().slice(0,max):null;
const score=value=>Number.isFinite(value)?Math.max(0,Math.min(100,Number(value))):null;
const load=async(file,fallback)=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return structuredClone(fallback);throw error;}};
const save=async(file,value)=>{const temp=path.join(path.dirname(file),`${path.basename(file)}.${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(value),{flag:'wx'});await rename(temp,file);};

export class ExperienceService {
  constructor({experiencePath,timingPath,now=()=>new Date().toISOString()}){this.experiencePath=experiencePath;this.timingPath=timingPath;this.now=now;this.experiences={version:1,records:[]};this.timings={version:1,operations:{}};}
  async init(){this.experiences=await load(this.experiencePath,{version:1,records:[]});this.timings=await load(this.timingPath,{version:1,operations:{}});if(this.experiences.version!==1||!Array.isArray(this.experiences.records)||this.timings.version!==1||!this.timings.operations)throw Error('Unsupported operational history format');return this;}
  async record_experience(value){
    const record={experience_id:value.experience_id||randomUUID(),animation_type:cleanText(value.animation_type,64),character_category:cleanText(value.character_category,80),issue_type:cleanText(value.issue_type,100),frame_index:Number.isInteger(value.frame_index)?value.frame_index:null,phase:cleanText(value.phase,80),repair_action:cleanText(value.repair_action,100)||'regenerate',strategy_source:cleanText(value.strategy_source,40)||'default',repair_instruction_summary:cleanText(value.repair_instruction_summary),provider:cleanText(value.provider,80),technical_score_before:score(value.technical_score_before),semantic_score_before:score(value.semantic_score_before),technical_score_after:score(value.technical_score_after),semantic_score_after:score(value.semantic_score_after),repair_succeeded:Boolean(value.repair_succeeded),created_at:value.created_at||this.now()};
    const index=this.experiences.records.findIndex(item=>item.experience_id===record.experience_id);if(index<0)this.experiences.records.push(record);else this.experiences.records[index]=record;this.experiences.records=this.experiences.records.slice(-500);await save(this.experiencePath,this.experiences);return structuredClone(record);
  }
  query_relevant_experience(query,{limit=50}={}){
    const weighted=this.experiences.records.map(record=>{let relevance=0;if(query.animation_type&&record.animation_type===query.animation_type)relevance+=4;if(query.issue_type&&record.issue_type===query.issue_type)relevance+=5;if(query.character_category&&record.character_category===query.character_category)relevance+=2;if(query.provider&&record.provider===query.provider)relevance+=1;if(query.repair_action&&record.repair_action===query.repair_action)relevance+=1;return {record,relevance};}).filter(item=>item.relevance>=5).sort((a,b)=>b.relevance-a.relevance||b.record.created_at.localeCompare(a.record.created_at)).slice(0,limit);return weighted.map(item=>({...structuredClone(item.record),relevance:item.relevance}));
  }
  rank_repair_strategies(query,defaultAction){
    const records=this.query_relevant_experience(query),groups=new Map();for(const record of records){const item=groups.get(record.repair_action)||{repair_action:record.repair_action,historical_attempts:0,weighted_successes:0,total_weight:0};item.historical_attempts++;item.total_weight+=record.relevance;item.weighted_successes+=record.repair_succeeded?record.relevance:0;groups.set(record.repair_action,item);}
    const ranked=[...groups.values()].map(item=>({...item,historical_success_rate:item.total_weight?item.weighted_successes/item.total_weight:0})).sort((a,b)=>b.historical_success_rate-a.historical_success_rate||b.historical_attempts-a.historical_attempts||a.repair_action.localeCompare(b.repair_action));
    const attempts=ranked.reduce((sum,item)=>sum+item.historical_attempts,0),best=ranked[0];if(attempts<2||!best)return {repair_action:defaultAction,strategy_source:'default',historical_attempts:attempts,historical_success_rate:null,ranked_strategies:ranked};return {...best,strategy_source:'experience',ranked_strategies:ranked};
  }
  async record_timing(operation,provider,durationMs){if(!Number.isFinite(durationMs)||durationMs<0)return null;const key=`${provider||'any'}:${operation}`,old=this.timings.operations[key],samples=(old?.samples||0)+1,average_ms=old?Math.round(old.average_ms*.7+durationMs*.3):Math.round(durationMs);const item={operation,provider:provider||null,samples,average_ms,last_ms:Math.round(durationMs),updated_at:this.now()};this.timings.operations[key]=item;await save(this.timingPath,this.timings);return structuredClone(item);}
  average_duration(operation,provider){return this.timings.operations[`${provider||'any'}:${operation}`]?.average_ms??this.timings.operations[`any:${operation}`]?.average_ms??null;}
  async ensure_persisted(){await save(this.experiencePath,this.experiences);const value=await load(this.experiencePath,null);if(!value||value.version!==1||!Array.isArray(value.records)||value.records.length!==this.experiences.records.length)throw Error('Experience history could not be verified');return {record_count:value.records.length};}
}
