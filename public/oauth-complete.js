const params=new URLSearchParams(location.search);
const connected=params.get('result')==='connected';
const platform=params.get('platform')==='instagram'?'instagram':'youtube';
const platformName=platform==='instagram'?'Instagram':'YouTube';
const error=params.get('error') || 'Please try connecting again.';
document.querySelector('#result').textContent=connected?platformName+' connected':'Connection incomplete';
document.querySelector('#message').textContent=connected?'You can close this window and return to your channels.':error;
if(window.opener)window.opener.postMessage({type:platform+'-connection',connected,error:connected?undefined:error},location.origin);
history.replaceState(null,'',location.pathname);
