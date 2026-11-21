import { databasePool, schema } from '../lib/database.js';

try{
  await databasePool().query(schema);
  console.log('PostgreSQL schema is ready.');
}catch(error){
  console.error('Database setup failed:',error.code || error.name);
  process.exitCode=1;
}finally{
  if(process.env.DATABASE_URL)await databasePool().end();
}
