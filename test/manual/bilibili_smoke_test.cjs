// test/manual/bilibili_smoke_test.cjs
// Self-contained smoke test for Bilibili provider modules.

const assert = require('node:assert');
const { createBilibiliSessionRepository } = require('../../electron/bilibili/session.cjs');
const { createBilibiliMediaPolicy } = require('../../electron/bilibili/mediaCors.cjs');
const { createBilibiliApi } = require('../../electron/bilibili/bilibiliApi.cjs');

async function runTests() {
  console.log('--- 1. Testing Session Repository ---');
  const memoryStore = new Map();
  const mockStore = {
    get: (k) => memoryStore.get(k),
    set: (k, v) => memoryStore.set(k, v),
    delete: (k) => memoryStore.delete(k)
  };
  const mockSafeStorage = {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'dpapi',
    encryptString: (str) => Buffer.from(str).toString('base64'),
    decryptString: (buf) => Buffer.from(buf.toString('utf8'), 'base64').toString('utf8')
  };

  const sessions = createBilibiliSessionRepository({
    store: mockStore,
    safeStorage: mockSafeStorage
  });

  assert.strictEqual(sessions.get(), null, 'Initial session should be null');
  sessions.set({
    cookies: { SESSDATA: 'mock_sess', DedeUserID: '123456' },
    cookieString: 'SESSDATA=mock_sess; DedeUserID=123456',
    mid: '123456'
  });
  assert.strictEqual(sessions.getCookieString(), 'SESSDATA=mock_sess; DedeUserID=123456');
  assert.strictEqual(sessions.getMid(), '123456');
  console.log('✓ Session repository passed');

  console.log('--- 2. Testing Media Policy (Referer & CORS) ---');
  const mediaPolicy = createBilibiliMediaPolicy();
  const testStreamUrl = 'https://upos-sz-mirror08c.bilivideo.com/upgcxcode/12/34/56789.m4a';
  mediaPolicy.register(testStreamUrl);

  assert.strictEqual(mediaPolicy.allows({
    url: testStreamUrl,
    resourceType: 'media',
    method: 'GET'
  }), true, 'Registered media URL should be allowed');

  assert.strictEqual(mediaPolicy.shouldInjectReferer(testStreamUrl), true, 'bilivideo.com should inject Referer');
  assert.strictEqual(mediaPolicy.shouldInjectReferer('https://i0.hdslb.com/cover.jpg'), true, 'hdslb.com should inject Referer');
  assert.strictEqual(mediaPolicy.shouldInjectReferer('https://example.com/audio.mp3'), false, 'other domains should not inject');
  console.log('✓ Media policy passed');

  console.log('--- 3. Testing Bilibili API ---');
  const api = createBilibiliApi({ sessions });

  // Test live video detail & audio resolving with real B站 public video
  console.log('Fetching live video detail for BV1uv411q7Mv...');
  const detailRes = await api.request('video_detail', { bvid: 'BV1uv411q7Mv' });
  assert.strictEqual(detailRes.ok, true, 'video_detail should succeed');
  assert.ok(detailRes.data.cid, 'Should have cid');
  console.log('✓ Video detail fetched successfully:', detailRes.data.title, 'cid:', detailRes.data.cid);

  console.log('Fetching audio playurl for BV1uv411q7Mv...');
  const audioRes = await api.request('audio', {
    bvid: 'BV1uv411q7Mv',
    cid: detailRes.data.cid,
    quality: 'high'
  });
  assert.strictEqual(audioRes.ok, true, 'audio resolving should succeed');
  assert.ok(audioRes.data.url, 'Should return audio stream URL');
  console.log('✓ Audio resolved successfully, URL host:', new URL(audioRes.data.url).host, 'quality:', audioRes.data.quality);

  console.log('Testing QR generate...');
  const qrRes = await api.request('login_qr_key');
  assert.strictEqual(qrRes.ok, true, 'login_qr_key should succeed');
  assert.ok(qrRes.data.key, 'QR code key should exist');
  console.log('✓ QR code generation passed, key:', qrRes.data.key);

  console.log('--- ALL SMOKE TESTS PASSED! ---');
}

runTests().catch(err => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
