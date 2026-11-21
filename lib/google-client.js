import {google} from 'googleapis';
import {OAuth2Client} from 'google-auth-library';

export function youtubeClient(channel){
  const auth=new OAuth2Client(process.env.GOOGLE_CLIENT_ID,process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({refresh_token:channel.youtube});
  return {auth,youtube:google.youtube({version:'v3',auth})};
}
