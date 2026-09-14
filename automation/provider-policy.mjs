const PROVIDERS=['external_manual','chatgpt_assisted','local_process','openai_api','gemini_api','cloudflare_flux'];
const DEFINITIONS={
  external_manual:{generation_mode:'assisted',requires_api_key:false,may_incur_cost:false},
  chatgpt_assisted:{generation_mode:'assisted',requires_api_key:false,may_incur_cost:false},
  local_process:{generation_mode:'local',requires_api_key:false,may_incur_cost:false},
  openai_api:{generation_mode:'automatic',requires_api_key:true,may_incur_cost:true},
  gemini_api:{generation_mode:'automatic',requires_api_key:true,may_incur_cost:true},
  cloudflare_flux:{generation_mode:'automatic',requires_api_key:true,may_incur_cost:true}
};
const integer=(value,name,defaultValue)=>{const result=value??defaultValue;if(!Number.isInteger(result)||result<0||result>100)throw Error(`${name} must be an integer from 0 to 100`);return result;};

export function normalizeProviderPolicy(value={},legacyDefault='external_manual'){
  if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Invalid image provider policy');
  const default_provider=value.default_provider||legacyDefault;if(!PROVIDERS.includes(default_provider))throw Error('Unknown default image provider');
  const fallback_providers=value.fallback_providers||[];if(!Array.isArray(fallback_providers)||fallback_providers.length>5||fallback_providers.some(id=>!PROVIDERS.includes(id))||new Set(fallback_providers).size!==fallback_providers.length)throw Error('Invalid fallback provider order');
  return {default_provider,fallback_providers:[...fallback_providers],allow_paid_providers:value.allow_paid_providers===true,allow_automatic_paid_fallback:value.allow_automatic_paid_fallback===true,require_confirmation_for_paid_request:value.require_confirmation_for_paid_request!==false,max_paid_image_generations_per_animation:integer(value.max_paid_image_generations_per_animation,'Maximum paid image generations',3),max_paid_repair_generations_per_animation:integer(value.max_paid_repair_generations_per_animation,'Maximum paid repair generations',3)};
}

export function providerCapabilities(instances={}){
  return PROVIDERS.map(provider_id=>{
    const definition=DEFINITIONS[provider_id],provider=instances[provider_id];let available=true,unavailable_reason=null;
    if(provider_id==='local_process'&&!provider?.config?.enabled){available=false;unavailable_reason='Local process provider is disabled';}
    else if(['openai_api','gemini_api','cloudflare_flux'].includes(provider_id)){const status=provider?.status?.();available=Boolean(status?.available);unavailable_reason=available?null:['missing_api_key','missing_credentials'].includes(status?.health)?'API credentials are not configured':'Provider is disabled';}
    else if(!provider){available=false;unavailable_reason='Provider is not configured';}
    return {provider_id,...definition,supports_generate_frame:true,supports_edit_frame:true,available,unavailable_reason};
  });
}

export function selectProvider(policy,requested,instances={}){
  const normalized=normalizeProviderPolicy(policy,requested),statuses=providerCapabilities(instances),first=requested||normalized.default_provider,candidates=[first,...normalized.fallback_providers.filter(id=>id!==first)];let selected=null;
  for(const [index,id] of candidates.entries()){const status=statuses.find(item=>item.provider_id===id);if(!status?.available)continue;if(index>0&&status.may_incur_cost&&(!normalized.allow_paid_providers||!normalized.allow_automatic_paid_fallback))continue;selected=status;break;}
  selected ||= statuses.find(item=>item.provider_id===first);if(!selected)throw Error('Unknown image provider');
  return {...selected,selected_provider:selected.provider_id,requested_provider:first,fallback_used:selected.provider_id!==first,fallback_chain:candidates,user_action_required:selected.generation_mode==='assisted',paid_request:selected.may_incur_cost,confirmation_required:selected.may_incur_cost&&normalized.require_confirmation_for_paid_request};
}

export function authorizePaidRequest(policy,decision,usage={},operation='generation',confirmed=false){
  const normalized=normalizeProviderPolicy(policy);if(!decision.may_incur_cost)return {paid:false,counter:null};
  if(!normalized.allow_paid_providers)throw Error('Paid image API requests are disabled by provider policy');
  if(normalized.require_confirmation_for_paid_request&&confirmed!==true)throw Error('Explicit confirmation is required for this paid image API request');
  const repair=operation==='repair',counter=repair?'paid_repairs':'paid_generations',limit=repair?normalized.max_paid_repair_generations_per_animation:normalized.max_paid_image_generations_per_animation,current=Number.isInteger(usage[counter])?usage[counter]:0;
  if(current>=limit)throw Error(`Paid ${repair?'repair':'generation'} limit reached for this animation`);
  return {paid:true,counter,next:current+1,limit};
}

export const providerIds=()=>[...PROVIDERS];
