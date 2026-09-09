(() => {
 if(!location.pathname.startsWith('/ui/'))return;
 const token=location.hash.slice(1)||sessionStorage.getItem('sprited-token');if(token)sessionStorage.setItem('sprited-token',token);history.replaceState(null,'',location.pathname);
 async function load(){const r=await fetch('/ui/editor-project',{headers:{authorization:'Bearer '+token}});if(r.ok)await window.SpritedCore.dispatch('open',{project:await r.json()});}
 window.addEventListener('message',e=>{if(e.origin===location.origin&&e.data?.type==='sprited-load-project')void load();});void load();
})();
