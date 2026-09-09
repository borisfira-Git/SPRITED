// A live MCP client is distinct from an available SPRITED server.
export class Connections {
  constructor(clock=()=>Date.now(),ttl=90000){this.clock=clock;this.ttl=ttl;this.sessions=new Map();}
  heartbeat({session_id,agent}){if(this.sessions.size>=32&&!this.sessions.has(session_id))throw Error('Too many agent sessions');this.sessions.set(session_id,{agent,last_seen:this.clock()});return this.status();}
  disconnect({session_id}){this.sessions.delete(session_id);return this.status();}
  status(){const now=this.clock();for(const [id,s] of this.sessions)if(now-s.last_seen>=this.ttl)this.sessions.delete(id);const agents=[...this.sessions.values()].map(s=>({agent:s.agent,last_seen:new Date(s.last_seen).toISOString()}));return {server_ready:true,external_agent_connected:agents.length>0,overall:agents.length?'AI READY':'AI OFFLINE',agents,heartbeat_timeout_seconds:this.ttl/1000,generation_capability_verified:false};}
}
