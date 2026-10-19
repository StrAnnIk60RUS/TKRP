import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  aspectRatioFor,
  generatePublicationMedia,
  mediaKindForFormat,
  resolveStoredMediaPath
} from '../src/modules/planning/services/mediaGenerationService.js';
import { generatePostContent } from '../src/modules/planning/services/llmPostGeneration.js';

test('mediaKindForFormat maps visual formats and skips text', () => {
  assert.equal(mediaKindForFormat('image'), 'image');
  assert.equal(mediaKindForFormat('combined'), 'image');
  assert.equal(mediaKindForFormat('video'), 'video');
  assert.equal(mediaKindForFormat('text'), null);
});

test('aspectRatioFor picks portrait video and platform stills', () => {
  assert.equal(aspectRatioFor('instagram', 'video'), '9:16');
  assert.equal(aspectRatioFor('linkedin', 'video'), '16:9');
  assert.equal(aspectRatioFor('instagram', 'image'), '4:5');
  assert.equal(aspectRatioFor('vk', 'image'), '1:1');
});

test('resolveStoredMediaPath rejects names outside the media directory', () => {
  assert.equal(resolveStoredMediaPath('../secret.png'), null);
  assert.equal(resolveStoredMediaPath('not-a-file'), null);
  assert.equal(resolveStoredMediaPath(''), null);
});

test('generatePublicationMedia stores an image returned by OpenRouter', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tkrp-media-'));
  const http = {
    async request(config) {
      assert.equal(config.url, 'https://openrouter.ai/api/v1/images');
      assert.equal(config.data.model, 'black-forest-labs/flux.2-pro');
      assert.equal(config.data.aspect_ratio, '4:5');
      assert.equal(config.data.resolution, '1K');
      return {
        status: 200,
        data: {
          data: [{ b64_json: Buffer.from('png-bytes').toString('base64'), media_type: 'image/png' }]
        }
      };
    }
  };
  try {
    const media = await generatePublicationMedia(
      { prompt: 'a red kettle on a table', format: 'image', platform: 'instagram' },
      { http, apiKey: 'test-key', mediaDir: dir, imageModel: 'black-forest-labs/flux.2-pro' }
    );
    assert.equal(media.kind, 'image');
    assert.equal(media.status, 'ready');
    assert.match(media.file_name, /^[a-f0-9]{32}\.png$/);
    assert.equal(media.url, `/api/plan/media/files/${media.file_name}`);
    const stored = await readFile(join(dir, media.file_name));
    assert.equal(stored.toString(), 'png-bytes');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('generatePublicationMedia polls a video job and stores the clip', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tkrp-media-'));
  const previous = {
    audio: process.env.VIDEO_GENERATE_AUDIO,
    resolution: process.env.VIDEO_RESOLUTION,
    duration: process.env.VIDEO_DURATION_SEC
  };
  process.env.VIDEO_GENERATE_AUDIO = 'false';
  process.env.VIDEO_RESOLUTION = '720p';
  process.env.VIDEO_DURATION_SEC = '4';
  const http = {
    async request(config) {
      if (config.method === 'POST') {
        assert.equal(config.data.model, 'google/veo-3.1-lite');
        assert.equal(config.data.aspect_ratio, '9:16');
        assert.equal(config.data.resolution, '720p');
        assert.equal(config.data.generate_audio, false);
        return {
          status: 202,
          data: { id: 'job1', polling_url: 'https://openrouter.ai/api/v1/videos/job1', status: 'pending' }
        };
      }
      if (String(config.url).endsWith('/job1')) {
        return {
          status: 200,
          data: {
            status: 'completed',
            unsigned_urls: ['https://openrouter.ai/api/v1/videos/job1/content']
          }
        };
      }
      return {
        status: 200,
        data: Buffer.from('mp4-bytes'),
        headers: { 'content-type': 'video/mp4' }
      };
    }
  };
  try {
    const media = await generatePublicationMedia(
      { prompt: 'a kettle pouring tea', format: 'video', platform: 'vk' },
      {
        http,
        apiKey: 'test-key',
        mediaDir: dir,
        videoModel: 'google/veo-3.1-lite',
        sleep: async () => {},
        pollIntervalMs: 0,
        maxPolls: 3
      }
    );
    assert.equal(media.kind, 'video');
    assert.match(media.file_name, /\.mp4$/);
    const stored = await readFile(join(dir, media.file_name));
    assert.equal(stored.toString(), 'mp4-bytes');
  } finally {
    if (previous.audio === undefined) delete process.env.VIDEO_GENERATE_AUDIO;
    else process.env.VIDEO_GENERATE_AUDIO = previous.audio;
    if (previous.resolution === undefined) delete process.env.VIDEO_RESOLUTION;
    else process.env.VIDEO_RESOLUTION = previous.resolution;
    if (previous.duration === undefined) delete process.env.VIDEO_DURATION_SEC;
    else process.env.VIDEO_DURATION_SEC = previous.duration;
    await rm(dir, { recursive: true, force: true });
  }
});

test('generatePublicationMedia rejects an empty prompt and a text post', async () => {
  await assert.rejects(
    () => generatePublicationMedia({ prompt: '  ', format: 'image' }, { apiKey: 'test-key' }),
    /пуст/
  );
  await assert.rejects(
    () => generatePublicationMedia({ prompt: 'a scene', format: 'text' }, { apiKey: 'test-key' }),
    /image, video и combined/
  );
});

test('generatePostContent in TEST_MODE adds a media prompt only for visual formats', async () => {
  const previous = process.env.TEST_MODE;
  process.env.TEST_MODE = 'true';
  try {
    const image = await generatePostContent({}, { format: 'image' }, {}, {});
    const text = await generatePostContent({}, { format: 'text' }, {}, {});
    assert.equal(image.media_prompt, 'Test media prompt');
    assert.equal(text.media_prompt, '');
  } finally {
    if (previous === undefined) delete process.env.TEST_MODE;
    else process.env.TEST_MODE = previous;
  }
});

test('generatePublicationMedia does not send Authorization header to third-party CDN', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tkrp-media-cdn-'));
  let contentDownloadHeaders = null;
  const http = {
    async request(config) {
      if (config.method === 'POST') {
        return {
          status: 202,
          data: { id: 'job-cdn', polling_url: 'https://openrouter.ai/api/v1/videos/job-cdn', status: 'pending' }
        };
      }
      if (String(config.url).endsWith('/job-cdn')) {
        return {
          status: 200,
          data: {
            status: 'completed',
            unsigned_urls: ['https://cdn.example-storage.com/bucket/video123.mp4']
          }
        };
      }
      contentDownloadHeaders = config.headers;
      return {
        status: 200,
        data: Buffer.from('mp4-bytes-cdn'),
        headers: { 'content-type': 'video/mp4' }
      };
    }
  };
  try {
    const media = await generatePublicationMedia(
      { prompt: 'test cdn video', format: 'video', platform: 'vk' },
      {
        http,
        apiKey: 'super-secret-openrouter-key',
        mediaDir: dir,
        videoModel: 'google/veo-3.1-lite',
        sleep: async () => {},
        pollIntervalMs: 0,
        maxPolls: 2
      }
    );
    assert.equal(media.status, 'ready');
    assert.ok(contentDownloadHeaders);
    assert.equal(contentDownloadHeaders.Authorization, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

