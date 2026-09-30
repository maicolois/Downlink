import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getInitialCarouselVideoIndex,
  getInstagramCarouselItemFromUrl,
} from '@/shared/carousel-selection.js';

const videos = [
  { id: 'video-1', playlistItem: 1 },
  { id: 'video-2', playlistItem: 3 },
  { id: 'video-3', playlistItem: 4 },
  { id: 'video-4', playlistItem: 6 },
];

test('reads the original Instagram carousel item from img_index', () => {
  assert.equal(
    getInstagramCarouselItemFromUrl('https://www.instagram.com/p/Dcq8Gs4CiUp/?img_index=4'),
    4
  );
  assert.equal(
    getInstagramCarouselItemFromUrl('instagram.com/p/Dcq8Gs4CiUp/?img_index=3&utm_source=copy'),
    3
  );
});

test('selects the matching video while omitting image-only carousel items', () => {
  assert.equal(
    getInitialCarouselVideoIndex(videos, 'https://www.instagram.com/p/example/?img_index=4'),
    2
  );
});

test('skips a requested image and selects the following available video', () => {
  assert.equal(
    getInitialCarouselVideoIndex(videos, 'https://www.instagram.com/p/example/?img_index=2'),
    1
  );
  assert.equal(
    getInitialCarouselVideoIndex(videos, 'https://www.instagram.com/p/example/?img_index=5'),
    3
  );
  assert.equal(
    getInitialCarouselVideoIndex(videos, 'https://www.instagram.com/p/example/?img_index=9'),
    3
  );
});

test('defaults to the first video for missing or invalid Instagram indices', () => {
  assert.equal(getInitialCarouselVideoIndex(videos, 'https://www.instagram.com/p/example/'), 0);
  assert.equal(getInitialCarouselVideoIndex(videos, 'https://example.com/?img_index=4'), 0);
  assert.equal(getInitialCarouselVideoIndex(videos, 'invalid'), 0);
});
