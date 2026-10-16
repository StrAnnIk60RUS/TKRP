import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canUseInstagram,
  isInstagramUrl,
  requestUsesInstagram,
  INSTAGRAM_PREVIEW_USERNAME
} from '../src/modules/auth/services/instagramAccess.js';

test('instagram access is limited to the preview username', () => {
  assert.equal(INSTAGRAM_PREVIEW_USERNAME, 'admin123');
  assert.equal(canUseInstagram({ username: 'admin123' }), true);
  assert.equal(canUseInstagram({ username: 'Admin123' }), false);
  assert.equal(canUseInstagram({ username: 'other' }), false);
  assert.equal(canUseInstagram(null), false);
});

test('instagram profile urls are recognized and other hosts are not', () => {
  assert.equal(isInstagramUrl('https://www.instagram.com/acme/'), true);
  assert.equal(isInstagramUrl('https://instagram.com/acme'), true);
  assert.equal(isInstagramUrl('instagram.com/acme'), true);
  assert.equal(isInstagramUrl('https://vk.com/acme'), false);
  assert.equal(isInstagramUrl('https://www.linkedin.com/company/acme/'), false);
  assert.equal(isInstagramUrl('not a url'), false);
});

test('instagram is detected only in platform and url fields', () => {
  assert.equal(requestUsesInstagram({ url: 'https://www.instagram.com/acme/' }), true);
  assert.equal(
    requestUsesInstagram({ competitor_urls: ['https://vk.com/acme', 'https://www.instagram.com/acme/'] }),
    true
  );
  assert.equal(
    requestUsesInstagram({ formData: { platforms: ['instagram'] } }),
    true
  );
  assert.equal(requestUsesInstagram({ form_input: { platforms: ['vk', 'instagram'] } }), true);
  assert.equal(
    requestUsesInstagram({
      form_input: { publications: [{ platform: 'instagram', topic: 'launch' }] }
    }),
    true
  );
  assert.equal(
    requestUsesInstagram({
      competitors_data: { competitors: [{ platform: 'vk', url: 'https://vk.com/acme' }] }
    }),
    false
  );
  assert.equal(
    requestUsesInstagram({
      form_input: {
        projectDescription: 'Упоминание instagram.com/acme в тексте не включает платформу',
        platforms: ['linkedin']
      }
    }),
    false
  );
});
