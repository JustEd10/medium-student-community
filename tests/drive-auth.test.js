import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readDesktopClient, authorizationParameters, connectDrive} from '../scripts/connect-drive.mjs';
test('Drive connection requests per-file offline access with PKCE and validates desktop client', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medium-drive-auth-'));
  try {
    const file=path.join(dir,'client.json');
    fs.writeFileSync(file,JSON.stringify({web:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture'}}));
    assert.throws(()=>readDesktopClient(file),/DESKTOP/);
    fs.writeFileSync(file,JSON.stringify({installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture'}}));
    const client=readDesktopClient(file);
    const params=authorizationParameters(client.client_id,'http://127.0.0.1:12345/callback','state','verifier');
    assert.equal(params.get('scope'),'https://www.googleapis.com/auth/drive.file');
    assert.equal(params.get('access_type'),'offline');
    assert.equal(params.get('code_challenge_method'),'S256');
    assert.equal(params.get('code_challenge'),crypto.createHash('sha256').update('verifier').digest('base64url'));
    await assert.rejects(connectDrive({clientFile:file,configFile:path.resolve('src/not-a-secret.json'),recoveryKeyFile:path.join(dir,'key.json')}),/PRIVATE_DESTINATION/);
    const occupied=path.join(dir,'occupied.json'); fs.writeFileSync(occupied,'untouched');
    await assert.rejects(connectDrive({clientFile:file,configFile:occupied,recoveryKeyFile:path.join(dir,'key.json')}),/DESTINATION_EXISTS/);
    assert.equal(fs.readFileSync(occupied,'utf8'),'untouched');
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('loopback authorization rejects Unicode state, uses mocked Google only and saves private config plus separate key', async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'medium-drive-flow-'));
  const clientFile=path.join(dir,'client.json'); const configFile=path.join(dir,'config.json'); const recoveryKeyFile=path.join(dir,'recovery.json');
  fs.writeFileSync(clientFile,JSON.stringify({installed:{client_id:'fixture.apps.googleusercontent.com',client_secret:'fixture'}}));
  let resolveReady; const ready=new Promise(resolve=>{resolveReady=resolve;}); let tokenCalls=0;
  const mockGoogle=async(url,options)=>{
    assert.equal(options.redirect,'error');
    if(url==='https://oauth2.googleapis.com/token') {
      tokenCalls++;
      assert.equal(options.body.get('grant_type'),'authorization_code');
      assert.equal(options.body.get('code'),'fixture-code');
      assert.ok(options.body.get('code_verifier').length>=43);
      return new Response(JSON.stringify({access_token:'fixture-access',refresh_token:'fixture-refresh',scope:'https://www.googleapis.com/auth/drive.file'}));
    }
    if(url.includes('/permissions?')) return new Response(JSON.stringify({permissions:[{type:'user',role:'owner'}]}));
    if(url==='https://www.googleapis.com/drive/v3/files?fields=id,mimeType,ownedByMe') return new Response(JSON.stringify({id:'fixture-folder',mimeType:'application/vnd.google-apps.folder',ownedByMe:true}));
    assert.fail('Unexpected provider request');
  };
  const done=connectDrive({clientFile,configFile,recoveryKeyFile,fetchImpl:mockGoogle,onReady:resolveReady,timeoutMs:5000});
  try {
    const entry=await ready;
    const redirect=await fetch(entry,{redirect:'manual'}); assert.equal(redirect.status,302);
    const authorize=new URL(redirect.headers.get('location'));
    const callback=authorize.searchParams.get('redirect_uri');
    const bad=await fetch(`${callback}?state=${'я'.repeat(authorize.searchParams.get('state').length)}&code=fixture-code`);
    assert.equal(bad.status,400); assert.equal(tokenCalls,0); assert.equal(fs.existsSync(configFile),false);
    const response=await fetch(`${callback}?state=${authorize.searchParams.get('state')}&code=fixture-code`);
    assert.equal(response.status,200);
    assert.deepEqual(await done,{connected:true});
    const config=JSON.parse(fs.readFileSync(configFile)); const recovery=JSON.parse(fs.readFileSync(recoveryKeyFile));
    assert.equal(config.enabled,true); assert.equal(config.refreshToken,'fixture-refresh'); assert.equal(config.folderId,'fixture-folder');
    assert.equal(config.encryptionKey,recovery.encryptionKey); assert.equal(Buffer.from(recovery.encryptionKey,'base64').length,32);
    assert.equal(fs.statSync(configFile).mode&0o777,0o600); assert.equal(fs.statSync(recoveryKeyFile).mode&0o777,0o600);
    assert.equal(tokenCalls,1);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
