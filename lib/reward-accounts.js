import {read,save,fail} from './storage.js';

export async function rewardAccount(id){
  if(!/^[a-z0-9][a-z0-9-]{0,47}$/.test(id || ''))throw fail(400,'Select a reward account.');
  const account=(await read('rewardAccounts/'+id)).value;
  if(account.platform!=='contentrewards')throw fail(400,'Unsupported reward platform.');
  return account;
}
// Permanent ownership claims use the record primary key to arbitrate concurrent requests.
export async function bindYouTube(channelId,accountId){
  const account=await rewardAccount(accountId);
  if(!channelId)throw fail(409,'Connect YouTube with OAuth before submitting to rewards.');
  const name='rewardBindings/'+account.platform+'/youtube/'+channelId;
  try{await save(name,{channelId,rewardAccountId:account.id,platform:account.platform});}
  catch(error){
    if(error.status!==409)throw error;
    const owner=(await read(name)).value;
    if(owner.rewardAccountId!==account.id)throw fail(409,'This YouTube channel is already assigned to another reward account.');
  }
}
