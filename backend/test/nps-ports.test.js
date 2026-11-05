import assert from 'node:assert/strict';
import test from 'node:test';
import tar from 'tar-stream';
import { PassThrough } from 'node:stream';
import { parseNpsPorts, readNpsPorts } from '../src/services/nps-ports.js';
import { scanProjectWebPorts, buildWebUiLinks } from '../src/services/project-ports.js';
const config = 'web_port=8081\nweb_open_ssl=false\nbridge_type=tcp\nbridge_port=8024\nhttp_proxy_port=1180\nhttps_proxy_port=11443\nweb_password=must-not-leak\nauth_key=must-not-leak\n';
const details = { Config: { Image: 'yisier1/nps:latest' }, HostConfig: { NetworkMode: 'host' }, Mounts: [{ Destination: '/conf' }] };
function archive(content, header = {}) { const pack = tar.pack(); pack.entry({ name: 'nps.conf', ...header }, content); pack.finalize(); return pack; }

test('NPS 配置分别识别四类端口，仅管理页变为网页入口，不泄露密钥', () => {
 const hostPorts = parseNpsPorts(config);
 assert.deepEqual(hostPorts.map(p=>[p.port,p.label,p.type]), [[8024,'客户端连接','tcp'],[1180,'HTTP 代理','tcp'],[11443,'HTTPS 代理','tcp'],[8081,'管理','tcp']]);
 const links = buildWebUiLinks('nas.example', scanProjectWebPorts({ containers: [{ id:'nps',state:'running',networkMode:'host',hostPorts }] }));
 assert.equal(links[0].source,'host-config-file');
 assert.deepEqual(links[0].ports,[{port:8081,url:'http://nas.example:8081'}]);
 assert.equal(JSON.stringify(hostPorts).includes('must-not-leak'),false);
});
test('NPS 只接受有效端口，忽略注释与隧道节，支持 HTTPS 和 KCP', () => {
 const ports = parseNpsPorts('# web_port=1\n; bridge_port=1\n[common]\nweb_port=18443 # management\nweb_open_ssl=true\nbridge_type=kcp\nbridge_port=8024\nhttps_proxy_port=65536\nhttp_proxy_port=0\n[web]\nweb_port=9000');
 assert.deepEqual(ports.map(p=>[p.port,p.type]),[[8024,'udp'],[18443,'tcp']]);
 assert.equal(ports.find(p=>p.purpose==='web').scheme,'https');
 for (const value of ['-1','1e3','${WEB_PORT}','80,443','80/tcp']) assert.deepEqual(parseNpsPorts('web_port='+value),[]);
});
test('只在主机网络的 NPS 固定挂载配置读取，不创建容器或执行命令', async () => {
 let calls=0;
 const target={getArchive:async options=>{calls++;assert.deepEqual(options,{path:'/conf/nps.conf'});return archive(config);}};
 assert.equal((await readNpsPorts(target,details)).length,4);
 for (const item of [{...details,Config:{Image:'nginx:latest'}},{...details,Mounts:[]},{...details,HostConfig:{NetworkMode:'bridge'}}]) assert.deepEqual(await readNpsPorts(target,item),[]);
 assert.equal(calls,1);
});
test('缺失文件、目录、链接、大文件和超时安全回退，无挂起流', async () => {
 assert.deepEqual(await readNpsPorts({getArchive:async()=>{throw Error('missing');}},details),[]);
 for (const header of [{type:'symlink',linkname:'/etc/shadow'},{type:'directory',name:'nps.conf/'}]) {
  assert.deepEqual(await readNpsPorts({getArchive:async()=>archive('',header)},details),[]);
 }
 assert.deepEqual(await readNpsPorts({getArchive:async()=>archive('x'.repeat(65*1024))},details),[]);
 const stream=new PassThrough();
 assert.deepEqual(await readNpsPorts({getArchive:async()=>stream},details,10),[]);assert.equal(stream.destroyed,true);
 let finish;
 const pending=readNpsPorts({getArchive:()=>new Promise(resolve=>{finish=resolve;})},details,10);
 assert.deepEqual(await pending,[]);const late=new PassThrough();finish(late);await new Promise(resolve=>setImmediate(resolve));assert.equal(late.destroyed,true);
});
