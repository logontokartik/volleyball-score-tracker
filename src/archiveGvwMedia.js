/**
 * GVW club media embedded in the archive UI.
 * Winner photos are served from /public/images/<season>/ as local static assets.
 * If no image exists for a season, the value is null and no photo is shown.
 */

/**
 * Map of tournament key (must match keys in archiveData.json) → local image path.
 * Paths are relative to /public so they are served at the root in production.
 * null = no image available for that season.
 */
const WINNER_PHOTO_BY_KEY = {
  'Summer/Fall 2024':   '/images/Summer%202024/Winners.jpg',
  'Winter/Spring 2024': '/images/Spring%202024/Winners.jpg',
  'Summer 2023':        '/images/Summer%202023/Winners.jpg',
  'Winter 2023':        null,
  'Summer 2022':        '/images/Summer%202022/Winners.jpg',
  'Winter 2022':        '/images/Winter%202022/Winners.jpg',
  'Summer 2021':        '/images/Summer%202021/Winners.jpg',
  'Winter 2021':        '/images/Winter%202021/Winners.jpg',
  'Summer 2020':        '/images/Summer%202020/Winners.png',
  'Winter 2020':        '/images/Winter%202020/Winners.png',
  'Summer 2019':        '/images/Summer%202019/Winners.png',
  'Winter 2019':        '/images/Winter%202019/Winners.png',
  'Summer 2018':        '/images/Summer%202018/Winners.png',
  'Winter 2018':        '/images/Winter%202018/Winners.png',
  'Summer 2017':        '/images/Summer%202017/Winners.png',
  // Seasons without images yet
  'Winter/Spring 2025': null,
  'Summer 2025':        null,
  'Spring 2026':        null,
};

/** All known tournament keys in newest → oldest order (matches archiveData.json). */
const PAST_TOURNAMENTS_WINNER_KEYS = Object.keys(WINNER_PHOTO_BY_KEY);

/**
 * Winner photo strips on the champions tab — one hero image per season.
 * `runnersUp` left empty; the site pairs winner/runner text under one photo.
 */
export const CHAMPION_PHOTOS_BY_TOURNAMENT = Object.fromEntries(
  PAST_TOURNAMENTS_WINNER_KEYS.map((key) => {
    const url = WINNER_PHOTO_BY_KEY[key];
    return [
      key,
      {
        winners: url ? [url] : [],
        runnersUp: [],
      },
    ];
  })
);

/** Gallery on the Photos & video tab — only seasons that have an image. */
const galleryEntries = PAST_TOURNAMENTS_WINNER_KEYS
  .filter((key) => WINNER_PHOTO_BY_KEY[key] !== null)
  .map((key) => ({ key, url: WINNER_PHOTO_BY_KEY[key] }));

export const GVW_MEDIA_GALLERIES = [
  {
    id: 'past-tournaments-winners',
    title: 'Past tournaments — winner photos',
    caption: 'Winner photos by season (newest to oldest).',
    images: galleryEntries.map((e) => e.url),
    labels: galleryEntries.map((e) => e.key),
  },
];

/**
 * Optional embedded clip: set to a Google Drive preview URL (`…/file/d/FILE_ID/preview`) when available.
 * Stays in-app (iframe); leave null to hide the video block.
 */
export const GVW_EMBEDDED_VIDEO_IFRAME_SRC = null;
