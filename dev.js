import http from 'node:http';
import {readFile} from 'node:fs/promises';
import handler from './api/relay.js';
const files={'/oauth-complete.html':['oauth-complete.html','text/html'],'/oauth-complete.js':['oauth-complete.js','text/javascript'],'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/publishing.js':['publishing.js','text/javascript'],'/style.css':['style.css','text/css']};
http.createServer(async(req,res)=>{
  try{
    const path=new URL(req.url,'http://localhost').pathname;
    if(path.startsWith('/api/v1/')){
      let body='';for await(const chunk of req){body+=chunk;if(body.length>65536){res.writeHead(413).end();return;}}
      req.body=body;res.status=n=>{res.statusCode=n;return res;};res.json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
      return await handler(req,res);
    }
    if(!files[path]) return res.writeHead(404).end();
    res.setHeader('Content-Type',files[path][1]+'; charset=utf-8');
    res.end(await readFile(new URL('./public/'+files[path][0],import.meta.url)));
  }catch{res.writeHead(500).end();}
}).listen(Number(process.env.PORT || 3000),'127.0.0.1',()=>console.log('ClipRelay is ready at http://127.0.0.1:'+(process.env.PORT || 3000)));
