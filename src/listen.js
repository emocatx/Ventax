// Arranque del servidor.
// - Normal (npm start / npm run demo): solo esta PC (127.0.0.1), por HTTP. Nadie en la red puede entrar.
// - Red local (--lan): HTTPS en todas las interfaces, para tablets y celulares. Los PIN viajan cifrados.
//   El certificado se genera solo (autofirmado) en data/certs; cada equipo lo acepta una vez.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

const CERT_DIR = path.resolve(import.meta.dirname, '..', 'data', 'certs');

const lanIps = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

function findOpenssl() {
  const candidates = ['openssl', 'C:\\Program Files\\Git\\usr\\bin\\openssl.exe', 'C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe'];
  for (const c of candidates) {
    try { execFileSync(c, ['version'], { stdio: 'ignore' }); return c; } catch { /* siguiente */ }
  }
  return null;
}

// Certificado válido para localhost y las IP actuales de la PC. Se regenera si cambió la IP.
function ensureCert() {
  const key = path.join(CERT_DIR, 'key.pem'), cert = path.join(CERT_DIR, 'cert.pem'), ipsFile = path.join(CERT_DIR, 'ips.txt');
  const ips = ['127.0.0.1', ...lanIps()];
  const fresh = fs.existsSync(key) && fs.existsSync(cert) && fs.existsSync(ipsFile) && fs.readFileSync(ipsFile, 'utf8') === ips.join(',');
  if (!fresh) {
    const openssl = findOpenssl();
    if (!openssl) throw new Error('No se encontró openssl para crear el certificado HTTPS. Instala Git para Windows o coloca key.pem y cert.pem en ' + CERT_DIR);
    fs.mkdirSync(CERT_DIR, { recursive: true });
    const san = ['DNS:localhost', ...ips.map((ip) => 'IP:' + ip)].join(',');
    execFileSync(openssl, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '825',
      '-keyout', key, '-out', cert, '-subj', '/CN=VENTAX', '-addext', 'subjectAltName=' + san], { stdio: 'ignore' });
    fs.writeFileSync(ipsFile, ips.join(','));
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}

export function start(server, label = 'VENTAX') {
  const lan = process.argv.includes('--lan') || process.env.VENTAX_LAN === '1';
  const db = process.env.POS_DB || 'data/pos.db';
  if (!lan) {
    const port = Number(process.env.PORT) || 3000;
    server.listen(port, '127.0.0.1', () => console.log(`${label} en http://localhost:${port}  (solo esta PC · BD: ${db})\nPara tablets y celulares usa la versión de red: npm run lan`));
    return server;
  }
  const port = Number(process.env.PORT) || 3443;
  const secure = https.createServer(ensureCert(), server.listeners('request')[0]);
  secure.listen(port, '0.0.0.0', () => {
    console.log(`${label} en red local, cifrado (HTTPS) · BD: ${db}`);
    console.log(`  En esta PC:   https://localhost:${port}`);
    for (const ip of lanIps()) console.log(`  En la red:    https://${ip}:${port}`);
    console.log('La primera vez cada equipo mostrará "conexión no privada": es el certificado propio de VENTAX. Elige "Avanzado" y "Continuar".');
  });
  return secure;
}
