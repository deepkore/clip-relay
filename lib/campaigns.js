import {fail} from './storage.js';
import {campaignPage} from './content-rewards.js';

export function campaignName(value){
  if(typeof value!=='string')throw fail(400,'Provide a campaign name.');
  const name=value.trim();
  if(!/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,149}$/.test(name) || name.includes('..') || /[. ]$/.test(name))throw fail(400,'Use a campaign name without slashes or special path characters.');
  return name;
}
export function channelCampaigns(channel){
  return channel.campaigns ?? (channel.campaignUrls ?? (channel.campaignUrl?[channel.campaignUrl]:[])).map(url=>({name:new URL(url).pathname.split('/').filter(Boolean).at(-1),url}));
}
export function normalizeCampaigns(values){
  if(!Array.isArray(values))throw fail(400,'campaigns must be an array of names and URLs.');
  const names=new Set(),urls=new Set();
  return values.map(value=>{
    const name=campaignName(value?.name),url=campaignPage(value?.url);
    if(!url)throw fail(400,'Enter a valid Content Rewards campaign URL.');
    if(names.has(name.toLowerCase()) || urls.has(url))throw fail(400,'Campaign names and URLs must be unique within a channel.');
    names.add(name.toLowerCase());urls.add(url);
    return {name,url};
  });
}
