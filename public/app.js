import {createPublisher} from './publishing.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={Overview:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',Channels:'<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M7 3h10m-6 8 5 3-5 3z"/>','API keys':'<circle cx="8" cy="9" r="5"/><path d="m12 12 8 8 2-2-2-2 1-2-2-1"/>',Activity:'<path d="M2 12h4l3-7 5 14 3-7h5"/>',guide:'<path d="M3 4h7l2 2 2-2h7v15h-7l-2 2-2-2H3zM12 6v14"/>',route:'<circle cx="4" cy="12" r="2"/><circle cx="20" cy="5" r="2"/><circle cx="20" cy="19" r="2"/><path d="M6 12h4q3 0 3-4t5-3M10 12q3 0 3 4t5 3"/>',wave:'<path d="M2 10v4m4-8v12m4-15v18m4-16v14m4-11v8m4-6v4"/>',clap:'<path d="m3 8 17-5 1 5-17 5zM4 13h17v8H4zM7 7l3 3m3-5 3 3"/>',youtube:'<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z"/>',instagram:'<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><path d="M17 7h.1"/>',send:'<path d="m2 11 19-8-6 18-4-7-9-3zm9 3 10-11"/>',box:'<path d="m3 7 9-5 9 5-9 5zM3 7v10l9 5 9-5V7m-9 5v10"/>'};
const icon=(k,cl='')=>'<svg aria-hidden="true" class="icon '+cl+'" viewBox="0 0 24 24">'+paths[k]+'</svg>';
const pages={overview:'Overview',channels:'Channels',rewards:'Reward accounts',activity:'Activity',keys:'API keys',guide:'API guide'};
$('#nav').innerHTML=Object.entries(pages).map(([k,v])=>'<a href="#'+k+'">'+icon(k==='guide'?'guide':k==='rewards'?'box':v)+v+'</a>').join('');
let demo=false,admin=false,channels=[],jobs=[],rewardAccounts=[],rewardFilter='',page='overview',activityPage=1,activityPageSize=25,onSubmit,youtubeWindow,instagramWindow;
const publisher=createPublisher({
 step:(id,platform)=>api('videos/'+id+'/publish/'+platform,{}),
 onUpdate:job=>{jobs=jobs.map(existing=>existing.id===job.id?job:existing);render();},
 onState:()=>render()
});
const msg=s=>{$('#toast').textContent=s;setTimeout(()=>{if($('#toast').textContent===s)$('#toast').textContent='';},3500);};
async function api(path,body){
 const res=await fetch('/api/v1/'+path,{method:body?'POST':'GET',credentials:'same-origin',headers:{'X-ClipRelay-Request':'1',...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
 const data=await res.json();if(!res.ok){if(res.status===401){admin=false;render();}throw Error(data.error);}return data;
}
function example(){
 channels=[{name:'PodPulse',slug:'podpulse'},{name:'EntertainmentClips',slug:'entertainmentclips'}];
 jobs=[];
}
function modal(title,html,button,fn){
 $('#dialogTitle').textContent=title;$('#fields').innerHTML=html;$('#err').textContent='';$('#submit').textContent=button;onSubmit=fn;$('#modal').showModal();
}
$('#close').onclick=()=>$('#modal').close();
$('#form').onsubmit=async e=>{e.preventDefault();$('#submit').disabled=true;try{const keep=await onSubmit(Object.fromEntries(new FormData(e.target)));if(!keep)$('#modal').close();}catch(err){$('#err').textContent=err.message;}finally{$('#submit').disabled=false;}};
function field(label,name,value='',attrs=''){return '<label>'+label+'<input name="'+name+'" value="'+esc(value)+'" '+attrs+'></label>';}
function connect(){modal('Unlock workspace',field('Workspace admin token','token','','type="password" required autocomplete="current-password"'),'Unlock',async d=>{await api('auth/login',{token:d.token});admin=true;await reload();});}
async function reload(){if(!demo){const r=await api('overview');channels=r.channels;jobs=r.jobs;rewardAccounts=r.rewardAccounts || [];}render();}
function rewardOptions(selected='',empty='No reward account'){
 return '<option value="">'+esc(empty)+'</option>'+rewardAccounts.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===selected?' selected':'')+'>'+esc(a.name)+'</option>').join('');
}
function rewardName(id){return rewardAccounts.find(a=>a.id===id)?.name || 'Unassigned';}
function rewardProfileStatus(account){
 const saved=account.worker?.hasBrowserProfile;
 const label=saved===true?'Browser profile saved':saved===false?'No browser profile':'Not checked yet';
 const detail=saved===true?'Saved browser user data is available. Website login may need renewal.':saved===false?'Sign in on the worker to save browser user data.':'Start or update the home worker to report browser profile status.';
 return '<p><span class="profile-status '+(saved===true?'saved':saved===false?'missing':'unknown')+'">'+label+'</span></p><p>'+detail+(typeof saved==='boolean' && !account.worker.online?' Last reported by the offline worker.':'')+'</p>';
}
function rewardFilterControl(){return '<label>Reward account <select id="rewardFilter">'+rewardOptions(rewardFilter,'All reward accounts')+'</select></label>';}
function editReward(id){
 const account=rewardAccounts.find(a=>a.id===id) || {};
 modal(id?'Edit reward account':'Add reward account',field('Account name','name',account.name,'required maxlength="100"')+field('Account ID','id',account.id,id?'readonly':'required pattern="[a-z0-9](?:[a-z0-9]|-){0,47}"')+'<p>Platform: Content Rewards. Each account uses its own browser login. Once assigned, channels cannot switch accounts.</p>','Save',async d=>{
   if(demo){if(!id && rewardAccounts.some(a=>a.id===d.id))throw Error('Account ID is already in use.');if(id)Object.assign(account,d);else rewardAccounts.push({...d,platform:'contentrewards'});}
   else await api('reward-accounts'+(id?'/'+id:''),d);
   await reload();
 });
}
function campaignRow(c={}){return '<div class="campaign-row"><label>Campaign name<input data-campaign-name value="'+esc(c.name)+'" maxlength="150" placeholder="Summer campaign" required></label><label>Campaign URL<input data-campaign-url value="'+esc(c.url)+'" type="url" placeholder="https://contentrewards.com/c/campaigns/..." required></label><button type="button" class="textbtn" data-remove-campaign>Remove campaign</button></div>';}
function edit(slug){
 if(!demo&&!admin)return connect();
 const c=channels.find(x=>x.slug===slug)||{};
 const secret=(label,key)=>field(label,key,'','type="password" autocomplete="new-password" '+(c[key]?'placeholder="Saved · leave blank to keep"':''));
 const fields=field('Channel name','name',c.name,'required maxlength="100"')+field('R2 folder','slug',c.slug,slug?'readonly':'required pattern="[a-z0-9](?:[a-z0-9]|-){0,47}" placeholder="podpulse"')+'<label>Content Rewards account<select name="rewardAccountId"'+(c.rewardAccountId?' disabled':'')+'>'+rewardOptions(c.rewardAccountId)+'</select></label><p>One reward account can own several channels. An assigned channel cannot switch accounts. Save this selection before connecting YouTube.</p><section><h3>Content Rewards campaigns</h3><div id="campaignRows">'+(c.campaigns ?? (c.campaignUrls || []).map(url=>({name:url.split('/').filter(Boolean).pop(),url}))).map(campaignRow).join('')+'</div><button type="button" class="secondary" data-add-campaign>Add campaign</button><p>Give each campaign a unique name and URL. Send that campaignName when uploading a video.</p></section>'+
 ('<section class="account"><h3>YouTube</h3><p>'+esc(c.youtubeTitle || (c.youtube?'Connected':'Connect your YouTube channel to publish videos.'))+'</p>'+(slug?'<button type="button" class="secondary" data-youtube="'+esc(slug)+'">'+(c.youtube?'Reconnect YouTube':'Connect YouTube')+'</button>':'<p>Save this channel to connect YouTube.</p>')+'</section>'+
 '<section class="account"><h3>Instagram</h3><p>'+esc(c.instagramTitle || (c.instagram?'Connected':'Connect your Instagram account to publish Reels.'))+'</p>'+(slug?'<button type="button" class="secondary" data-instagram="'+esc(slug)+'">'+(c.instagram?'Reconnect Instagram':'Connect Instagram')+'</button>':'<p>Save this channel to connect Instagram.</p>')+'</section><details><summary>Alternative webhook delivery</summary>'+field('Campaign ID','campaign',c.campaign)+field('Submission webhook URL','webhook',c.webhook,'type="url"')+secret('Webhook bearer token','webhookToken')+'</details>');
 modal(slug?'Edit channel':'Add channel',fields,slug?'Save changes':'Create channel',async d=>{
  d.campaigns=[...document.querySelectorAll('#campaignRows .campaign-row')].map(row=>({name:row.querySelector('[data-campaign-name]').value.trim(),url:row.querySelector('[data-campaign-url]').value.trim()}));
  if(demo){if(!slug&&channels.some(x=>x.slug===d.slug))throw Error('That folder is already in use.');if(slug)Object.assign(c,d);else channels.push(d);}
  else{for(const k of ['youtube','instagram','webhookToken'])if(!d[k])delete d[k];await api('channels'+(slug?'/'+slug:''),d);}
  await reload();msg(slug?'Channel updated':'Channel created');});
}
const flow='<section class="flow"><div class="panelHead"><h2>'+icon('route')+' Publishing pipeline</h2><span class="micro">ROUTE MAP</span></div><svg class="route" viewBox="0 0 750 162" role="img" aria-label="Agent sends video to R2, which distributes to YouTube and Instagram and delivers links to campaigns"><defs><linearGradient id="lid" x2="1" y2="1"><stop stop-color="#d8cdff"/><stop offset="1" stop-color="#8c6bff"/></linearGradient><linearGradient id="side"><stop stop-color="#795bd1"/><stop offset="1" stop-color="#b099ff"/></linearGradient></defs><g fill="none" stroke="#9884c8" stroke-width="1.5" stroke-dasharray="4 5"><path d="M84 70H315M385 70h33q14 0 14-14v-9q0-12 13-12h36m-96 35h33q14 0 14 14v9q0 12 13 12h36M596 35h15q12 0 12 12v10q0 13 14 13h20m-61 35h15q12 0 12-12V83q0-13 14-13"/></g><g fill="#b49bff"><circle cx="207" cy="70" r="3"/><circle cx="429" cy="61" r="3"/><circle cx="621" cy="91" r="3"/></g><g transform="translate(39 47)"><rect width="48" height="45" rx="11" fill="#373246" stroke="#77668c"/><path d="m13 15 7 7-7 7m11 0h10" fill="none" stroke="#d1bbff" stroke-width="3"/></g><text x="63" y="116" text-anchor="middle">LLM agent</text><text class="mini" x="63" y="131" text-anchor="middle">Upload API</text><g transform="translate(351 62)"><ellipse cy="33" rx="54" ry="14" fill="#a282ff" opacity=".12"/><path d="m-43 3 43-22 43 22v12L0 37l-43-22z" fill="url(#side)"/><path d="m-43 3 43-22 43 22L0 25z" fill="#ba9fff"/><path d="m-43 -10 43-22 43 22V2L0 24-43 2z" fill="url(#side)"/><path d="m-43-10 43-22 43 22L0 12z" fill="url(#lid)"/><path d="m-12-10 12-6 12 6-12 6z" fill="#7858ce"/></g><text x="351" y="121" text-anchor="middle">Cloudflare R2</text><text class="mini" x="351" y="137" text-anchor="middle">Channel folders</text><g fill="#393445" stroke="#71657e"><rect x="479" y="19" width="118" height="32" rx="8"/><rect x="479" y="89" width="118" height="32" rx="8"/><rect x="655" y="47" width="46" height="45" rx="11"/></g><rect x="490" y="28" width="20" height="14" rx="4" fill="#fb656f"/><path d="m498 31 6 4-6 4" fill="white"/><g stroke="#ef8fc0" fill="none" stroke-width="2"><rect x="491" y="97" width="16" height="16" rx="4"/><circle cx="499" cy="105" r="3"/></g><text x="517" y="40">YouTube</text><text x="517" y="110">Instagram</text><path d="m667 70 8 7 15-17" fill="none" stroke="#a0e8c0" stroke-width="3"/><text x="678" y="116" text-anchor="middle">Campaign</text><text class="mini" x="678" y="131" text-anchor="middle">Post link</text></svg></section>';
function heading(title,desc,btn=''){return '<div class="heading"><div><h1>'+title+'</h1><p>'+desc+'</p></div>'+btn+'</div>';}
const add='<button class="primary" data-add>＋ Add channel</button>';
function cards(items){return items.length?'<div class="cards">'+items.map((c,i)=>'<button class="card" data-edit="'+esc(c.slug)+'"><div class="cardtop"><span class="logo '+(i%2?'b':'')+'">'+icon(i%2?'clap':'wave')+'</span><div><h3>'+esc(c.name)+'</h3><span class="mono">/'+esc(c.slug)+'/</span></div><span class="arrow">↗</span></div><div class="cardbottom">'+(c.youtube?'<span class="pill">'+icon('youtube','yt')+' '+(c.youtubeTitle?esc(c.youtubeTitle):'YouTube')+'</span>':'')+(c.instagram?'<span class="pill">'+icon('instagram','ig')+' '+(c.instagramTitle?esc(c.instagramTitle):'Instagram')+'</span>':'')+(!c.youtube&&!c.instagram?'<span class="pill">No publishing accounts</span>':'')+'<span class="pill">'+esc(rewardName(c.rewardAccountId))+'</span>'+((c.campaigns || c.campaignUrls)?.length?'<span class="pill">'+(c.campaigns || c.campaignUrls).length+' campaign'+((c.campaigns || c.campaignUrls).length===1?'':'s')+'</span>':'')+'</div></button>').join('')+'</div>':'<div class="box empty">Add a channel to set up its R2 folder and publishing accounts.</div>';}
function statusBadge(status){
 const tones={Delivered:'success',Published:'success',Uploaded:'success','Awaiting submission':'pending','Awaiting publication':'pending','Awaiting publish':'pending','Awaiting upload':'pending',Scheduled:'scheduled',Publishing:'progress',Submitting:'progress','Processing on YouTube':'progress','Check submission':'warning','Needs attention':'error','Submission failed':'error'};
 const tone=Object.hasOwn(tones,status)?tones[status]:'neutral';
 return '<span class="tag status-'+tone+'">'+esc(status)+'</span>';
}
function table(items){const rows=items.flatMap(j=>Object.entries(j.targets).map(([p,d])=>{
  const showProgress=!d.error && ['Publishing','Processing on YouTube','Uploaded'].includes(d.status);
  const uploadPct=(Number.isFinite(d.uploadedBytes) && d.totalBytes && d.uploadedBytes<d.totalBytes)?Math.floor(d.uploadedBytes/d.totalBytes*100):100;
  const uploadSub=showProgress?(uploadPct<100?'<small class="sub">Publishing '+uploadPct+'%</small>':'<small class="sub">Publish 100%</small>'):'';
  const publishBtn = !demo ? (publisher.isActive(j.id,p)
    ? '<button class="textbtn" data-step="'+j.id+'/'+p+'" disabled>Publishing… keep this page open</button>'
    : (d.status === 'Needs attention'
      ? '<button class="textbtn" data-step="'+j.id+'/'+p+'">Retry publishing</button>'
      : (d.status === 'Awaiting publish' || d.status === 'Awaiting upload' || d.status === 'Scheduled'
        ? '<button class="textbtn" data-step="'+j.id+'/'+p+'">Publish</button>'
        : ''))) : '';
  const campaignLabel = esc(j.campaignName || 'Campaign');
  const campaignCell = (d.submissions && d.submissions.length)
    ? d.submissions.map(s => (s.campaignUrl ? '<a target="_blank" rel="noreferrer" href="'+esc(s.campaignUrl)+'">'+campaignLabel+'</a>' : campaignLabel) + (s.status==='Check submission'?'<small class="sub"><button class="textbtn" data-review="'+j.id+'/'+p+'" data-campaign="'+esc(s.campaignUrl)+'">Resolve</button></small>':'')).join('')
    : (j.campaignUrl ? '<a target="_blank" rel="noreferrer" href="'+esc(j.campaignUrl)+'">'+campaignLabel+'</a>' : '<span>'+campaignLabel+'</span>');
  const postLinkCell = d.url
    ? '<a target="_blank" rel="noreferrer" href="'+esc(d.url)+'">View post ↗</a>'
    : (!demo && d.needsPermalink ? '<button class="textbtn" data-link="'+j.id+'">Attach link</button>' : '<span class="sub">—</span>');
  const submissionErrors = (d.submissions || []).filter(s=>s.error && s.status!=='Delivered').map(s=>'<small class="sub">'+esc(s.error)+'</small>').join('');
  const actionCell = submissionErrors+((d.submissions || []).some(s=>s.status==='Awaiting submission')?'<small class="sub">'+(d.homeDelivery?.accepted?'Home PC queued':esc(d.homeDelivery?.error || 'Ready to send to home PC'))+' <button class="textbtn" data-dispatch="'+j.id+'/'+p+'">Send to home PC</button></small>':'')+publishBtn;
  return '<tr><td>'+esc(j.title)+'</td><td>'+esc(j.channel)+'</td><td>'+esc(p==='youtube'?'YouTube':'Instagram')+'</td><td>'+statusBadge(d.status)+uploadSub+(d.error?'<small class="sub">'+esc(d.error)+'</small>':'')+'</td><td>'+campaignCell+'</td><td>'+postLinkCell+'</td><td>'+actionCell+'</td></tr>';
}));return '<div class="box">'+(rows.length?'<table class="table"><thead><tr><th>Video</th><th>Channel</th><th>Platform</th><th>Status</th><th>Campaign</th><th>Post link</th><th>Actions</th></tr></thead><tbody>'+rows.join('')+'</tbody></table>':'<p class="empty">Videos appear here when your agent requests an upload.</p>')+'</div>';}
function section(name,link,label){return '<div class="sectionhead"><h2>'+name+'</h2>'+(link?'<a class="textbtn" href="#'+link+'">'+label+' →</a>':'')+'</div>';}
const stat=(label,value,k,cl)=>'<div class="stat"><span>'+label+'</span><strong>'+value+'</strong><i class="swatch '+cl+'">'+icon(k)+'</i></div>';
function render(){
 page=location.hash.slice(1);if(!pages[page])page='overview';$('#crumb').textContent=pages[page];document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.hash==='#'+page));
 $('#mode').textContent=demo?'Preview mode':admin?'Administrator':'Locked';$('#modeTop').textContent=demo?'Demo workspace':'Live workspace';
 const signout=$('#signout');if(signout)signout.hidden=!admin;
 let html='';
 if(!demo&&!admin)html=heading('Publishing workspace','Unlock this workspace to manage channels and agent uploads.','<button class="primary" data-login>Unlock workspace</button>')+flow;
 else if(page==='overview')html=heading('Publishing overview','Monitor your channels, video uploads, and campaign deliveries.',add)+flow+'<div class="stats">'+stat('Channels',channels.length,'Channels','')+stat('Video uploads',jobs.length,'box','teal')+stat('Campaign deliveries',jobs.flatMap(j=>Object.values(j.targets)).flatMap(d=>d.submissions?.length?d.submissions:[d]).filter(s=>s.status==='Delivered').length,'send','amber')+'</div>'+section('Your channels','channels','View channels')+cards(channels.slice(0,4))+section('Recent activity','activity','View activity')+table(jobs.slice(0,4));
 else if(page==='channels')html=heading('Channels','Manage channel folders, publishing accounts, and rewards campaigns.',add)+rewardFilterControl()+section('Channel directory')+cards(channels.filter(c=>!rewardFilter || c.rewardAccountId===rewardFilter));
 else if(page==='activity'){
  const filtered=jobs.filter(j=>!rewardFilter || j.rewardAccountId===rewardFilter);
  const pageSize=activityPageSize;
  const totalPages=Math.max(1,Math.ceil(filtered.length/pageSize));
  if(activityPage>totalPages)activityPage=totalPages;
  if(activityPage<1)activityPage=1;
  const start=(activityPage-1)*pageSize;
  const paged=filtered.slice(start,start+pageSize);
  const pageBtns=totalPages<=6
    ? Array.from({length:totalPages},(_,i)=>i+1).map(p=>'<button type="button" class="'+(p===activityPage?'primary':'secondary')+'" data-page-num="'+p+'">'+p+'</button>').join('')
    : '<span>Page '+activityPage+' of '+totalPages+'</span>';
  const pager='<div class="pagination"><span>Showing '+(filtered.length?start+1:0)+'–'+Math.min(start+pageSize,filtered.length)+' of '+filtered.length+' videos</span><div class="pages"><label class="pagesize">Per page: <select id="activityPageSize"><option value="10"'+(pageSize===10?' selected':'')+'>10</option><option value="25"'+(pageSize===25?' selected':'')+'>25</option><option value="50"'+(pageSize===50?' selected':'')+'>50</option><option value="100"'+(pageSize===100?' selected':'')+'>100</option></select></label><button type="button" class="secondary" data-page="prev"'+(activityPage<=1?' disabled':'')+'>Previous</button>'+pageBtns+'<button type="button" class="secondary" data-page="next"'+(activityPage>=totalPages?' disabled':'')+'>Next</button></div></div>';
  html=heading('Publishing activity','Track each video from agent upload to campaign delivery.','<button class="secondary" data-refresh>Refresh</button>')+rewardFilterControl()+section('Video history')+table(paged)+pager;
 }
 else if(page==='rewards')html=heading('Reward accounts','Group your YouTube channels under the Content Rewards account that owns them.','<button class="primary" data-add-reward>＋ Add reward account</button>')+'<div class="box docs">'+(rewardAccounts.length?rewardAccounts.map(a=>'<section><h3>'+esc(a.name)+'</h3>'+rewardProfileStatus(a)+'<p>Content Rewards · '+channels.filter(c=>c.rewardAccountId===a.id).length+' channels</p><p>Home worker: '+(a.worker?.online?'Online · '+esc(a.worker.state):'Offline')+(a.worker?.lastSeen?' · Last seen '+esc(new Date(a.worker.lastSeen).toLocaleString()):'')+'</p><p>On the worker, sign in to this account using:</p><pre>npm run login -- '+esc(a.id)+'</pre><p>Use this profile only for '+esc(a.name)+'.</p><button class="secondary" data-edit-reward="'+esc(a.id)+'">Edit name</button></section>').join(''):'<p>Add a reward account, sign in on the worker, then assign channels to it.</p>')+'</div>';
 else if(page==='keys')html=heading('Agent API keys','Issue a separate upload and publishing key for each channel.')+section('Channel access')+'<div class="box">'+(channels.length?'<table class="table"><thead><tr><th>Channel</th><th>Key status</th><th>Actions</th></tr></thead><tbody>'+channels.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+ (c.agentKey?'Active':'No key')+'</td><td><button class="secondary" data-key="'+esc(c.slug)+'">'+(c.agentKey?'Rotate key':'Create key')+'</button> '+(c.agentKey?'<button class="textbtn" data-revoke="'+esc(c.slug)+'">Revoke</button>':'')+'</td></tr>').join('')+'</tbody></table>':'<p class="empty">Create a channel first.</p>')+'</div>';
 else html=heading('Agent API guide','Use the channel API key as a Bearer token for every API call.')+'<div class="box docs"><h3>1. Request an upload</h3><pre>POST /api/v1/videos\nIdempotency-Key: &lt;UUID&gt;\nAuthorization: Bearer &lt;channel key&gt;\nContent-Type: application/json\n\n{"channel":"podpulse","title":"Episode highlight",\n "caption":"A moment from the show","platforms":["youtube","instagram"]}</pre><p>Each video belongs to one campaign. Send campaignName matching a campaign saved on the channel; the API looks up its URL automatically. A channel with one campaign selects it automatically.</p><h3>2. Upload video and thumbnail to R2</h3><p>Optional hookText, description, instagramDescription, and youtubeDescription are saved with the upload. Platform descriptions override the publishing caption. Include campaignName, videoFileName (ending in .mp4), and optional thumbnailFileName (ending in .jpg) in the creation request. Files use the channel/campaignName/filename path. PUT the MP4 to uploadUrl and the JPG to thumbnail.uploadUrl, each with its returned headers. URLs last 15 minutes; repeat the creation request with the same UUID and metadata to refresh them.</p><h3>3. Verify and log the upload</h3><pre>POST /api/v1/videos/{id}/upload-complete\nGET /api/v1/uploads/{uploadId}</pre><p>The database-generated uploadId identifies the upload log. Completion checks both requested files in R2. Status is pending, partial, invalid, or uploaded. Use unique filenames per campaign.</p><h3>4. Publish and collect links</h3><pre>POST /api/v1/videos/{id}/publish/{platform}\nGET  /api/v1/videos/{id}</pre><p>Call the publish endpoint for each platform sequentially until its status is Delivered, Published, or Awaiting submission. Wait 10 seconds between processing steps. Retry transient errors with backoff. Each result includes the published URL when available.</p></div>';
 $('#content').innerHTML=html;
}
document.addEventListener('click',async e=>{
 const b=e.target.closest('button');if(!b)return;const a=b.dataset;
 try{
 if('copyReviewLink'in a){
  const input=$('#reviewClipLink');
  try{await navigator.clipboard.writeText(input.value);msg('Clip link copied');}
  catch{input.focus();input.select();msg('Link selected. Press Ctrl+C to copy.');}
  return;
 }
 if('addCampaign'in a){$('#campaignRows').insertAdjacentHTML('beforeend',campaignRow());return;}
 if('removeCampaign'in a){b.closest('.campaign-row').remove();return;}
 if('addReward'in a)editReward();if(a.editReward)editReward(a.editReward);
 if(a.page==='prev'){activityPage=Math.max(1,activityPage-1);render();return;}
 if(a.page==='next'){activityPage++;render();return;}
 if(a.pageNum){activityPage=Number(a.pageNum)||1;render();return;}
 if('logout'in a){await api('auth/logout',{});admin=false;channels=[];jobs=[];rewardAccounts=[];rewardFilter='';render();}
 if(a.youtube){
  if(demo){
    const setup=await api('status');
    const missing=(setup.missing || []).map(name=>'<li><code>'+esc(name)+'</code></li>').join('');
    const invalid=(setup.invalid || []).map(message=>'<li>'+esc(message)+'</li>').join('');
    $('#modal').close();
    modal('Complete workspace setup','<p>Add the missing settings to your local .env file or Vercel environment variables.</p><ul>'+missing+invalid+'</ul><p>Restart the local server or redeploy, then reload this page. Configure storage before connecting YouTube.</p>','Close',()=>false);
    return;
  }
  youtubeWindow=window.open('about:blank','cliprelay-youtube','width=600,height=760');
  if(!youtubeWindow)throw Error('Allow popups to connect YouTube.');
  try{const result=await api('channels/'+a.youtube+'/youtube-connect',{});youtubeWindow.location=result.url;}
  catch(error){youtubeWindow.close();throw error;}
 }
 if(a.instagram){
  if(demo){
    const setup=await api('status');
    const missing=(setup.missing || []).map(name=>'<li><code>'+esc(name)+'</code></li>').join('');
    const invalid=(setup.invalid || []).map(message=>'<li>'+esc(message)+'</li>').join('');
    $('#modal').close();
    modal('Complete workspace setup','<p>Add the missing settings to your local .env file or Vercel environment variables.</p><ul>'+missing+invalid+'</ul><p>Restart the local server or redeploy, then reload this page. Configure storage before connecting Instagram.</p>','Close',()=>false);
    return;
  }
  instagramWindow=window.open('about:blank','cliprelay-instagram','width=600,height=760');
  if(!instagramWindow)throw Error('Allow popups to connect Instagram.');
  try{const result=await api('channels/'+a.instagram+'/instagram-connect',{});instagramWindow.location=result.url;}
  catch(error){instagramWindow.close();throw error;}
 }
 if('add'in a)edit();if(a.edit)edit(a.edit);if('login'in a)connect();if('refresh'in a){await reload();msg('Activity refreshed');}
 if(a.key||a.revoke){const slug=a.key||a.revoke;const c=channels.find(x=>x.slug===slug);
 if(demo){msg('Configure the live workspace to issue agent keys.');return;}
 modal(a.revoke?'Revoke agent key':c.agentKey?'Rotate agent key':'Create agent key','<p>'+esc(c.name)+(c.agentKey?' agents using the current key will lose access.':' will receive a channel-scoped agent key.')+'</p>',a.revoke?'Revoke':'Generate key',async()=>{
 const result=await api('channels/'+slug+'/'+(a.revoke?'revoke':'key'),{});await reload();
 if(result.key){$('#fields').innerHTML='<p>Copy this key now. It is shown once.</p><pre>'+esc(result.key)+'</pre>';$('#submit').textContent='Done';onSubmit=()=>false;return true;}
 });}
 if(a.dispatch){b.disabled=true;const [id,p]=a.dispatch.split('/');try{await api('videos/'+id+'/dispatch/'+p,{});}finally{await reload();}}
 if(a.step){const [id,p]=a.step.split('/');try{await publisher.run(id,p);msg('Publishing steps completed.');}finally{await reload();}}
 if(a.review){
  const [id,p]=a.review.split('/');
  const job=jobs.find(j=>j.id===id),clipUrl=job?.targets[p]?.url;
  const clip=clipUrl?'<label>Published clip link<input id="reviewClipLink" readonly value="'+esc(clipUrl)+'"></label><p><a target="_blank" rel="noopener noreferrer" href="'+esc(clipUrl)+'">Open clip ↗</a> <button type="button" class="textbtn" data-copy-review-link>Copy link</button></p>':'<p>The published clip link is unavailable. Refresh Activity before resolving.</p>';
  const campaign=a.campaign?'<p><a target="_blank" rel="noopener noreferrer" href="'+esc(a.campaign)+'">Open Content Rewards campaign ↗</a></p>':'';
  modal('Reconcile browser submission','<p>Stop the worker and check this exact post in the campaign’s Submissions list.</p>'+clip+campaign+'<label>What did you find?<select required name="outcome"><option value="">Choose an outcome</option><option value="received">The campaign received this post</option><option value="absent">The post is absent — allow retry</option></select></label>','Save outcome',async d=>{await api('videos/'+id+'/submission/'+p,{step:'resolve',outcome:d.outcome,campaignUrl:a.campaign});await reload();});
 }
 if(a.link)modal('Attach published Reel',field('Instagram permalink','url','','required type="url"'),'Attach link',async d=>{await api('videos/'+a.link+'/permalink/instagram',d);await reload();});
 }catch(err){msg(err.message);}
});
window.addEventListener('message',async event=>{
 if(event.origin!==location.origin)return;
 if(event.source===youtubeWindow && event.data?.type==='youtube-connection'){
  youtubeWindow.close();
  youtubeWindow=null;
  if(event.data.connected){
   $('#modal').close();
   try{await reload();msg('YouTube connected');}catch(error){msg(error.message);}
  }else{msg(event.data.error || 'YouTube connection cancelled.');}
 }
 if(event.source===instagramWindow && event.data?.type==='instagram-connection'){
  instagramWindow.close();
  instagramWindow=null;
  if(event.data.connected){
   $('#modal').close();
   try{await reload();msg('Instagram connected');}catch(error){msg(error.message);}
  }else{msg(event.data.error || 'Instagram connection cancelled.');}
 }
});
document.addEventListener('change',e=>{
 if(e.target.id==='rewardFilter'){rewardFilter=e.target.value;activityPage=1;render();}
 if(e.target.id==='activityPageSize'){activityPageSize=Number(e.target.value)||25;activityPage=1;render();}
});
setInterval(()=>{if(admin && page==='rewards' && !$('#modal').open)reload().catch(()=>{});},30000);
window.addEventListener('hashchange',render);
window.addEventListener('beforeunload',e=>{
 if(publisher.hasActive()){
  e.preventDefault();
  e.returnValue='';
 }
});
try{const s=await api('status');demo=!s.configured;if(demo){example();}else{admin=(await api('auth/session')).authenticated;if(admin)await reload();}render();}catch{ $('#content').innerHTML='<h1>Workspace unavailable</h1><p>Check the server connection and reload.</p>'; }
