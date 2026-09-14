// A live MCP client is distinct from an available SPRITED server.
export class Connections {
  constructor(clock=()=>Date.now(),ttl=90000,activeClient=null){this.clock=clock;this.ttl=ttl;this.activeClient=['codex','cline'].includes(activeClient)?activeClient:null;this.sessions=new Map();}
  client(agent){const value=String(agent||'').toLowerCase();return value.includes('codex')?'codex':value.includes('cline')?'cline':null;}
  select(client){if(!['codex','cline'].includes(client))throw Error('Choose Cline or Codex');this.activeClient=client;for(const [id,session] of this.sessions)if(session.client!==client)this.sessions.delete(id);return this.status();}
  heartbeat({session_id,agent}){const client=this.client(agent);if(!this.activeClient||client!==this.activeClient)return this.status();if(this.sessions.size>=32&&!this.sessions.has(session_id))throw Error('Too many agent sessions');this.sessions.set(session_id,{agent,client,last_seen:this.clock()});return this.status();}
  disconnect({session_id}){this.sessions.delete(session_id);return this.status();}
  status(){const now=this.clock();for(const [id,s] of this.sessions)if(now-s.last_seen>=this.ttl||s.client!==this.activeClient)this.sessions.delete(id);const agents=[...this.sessions.values()].map(s=>({agent:s.agent,last_seen:new Date(s.last_seen).toISOString()}));return {server_ready:true,active_external_client:this.activeClient,external_agent_connected:agents.length>0,overall:agents.length?'AI READY':'AI OFFLINE',agents,heartbeat_timeout_seconds:this.ttl/1000,generation_capability_verified:false};}
}
