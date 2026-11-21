import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function seal(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(process.env.ENCRYPTION_KEY,'hex'), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
export function unseal(body) {
  const buf = Buffer.from(body,'base64');
  const cipher = createDecipheriv('aes-256-gcm',Buffer.from(process.env.ENCRYPTION_KEY,'hex'),buf.subarray(0,12));
  cipher.setAuthTag(buf.subarray(12,28));
  return JSON.parse(Buffer.concat([cipher.update(buf.subarray(28)),cipher.final()]).toString());
}
