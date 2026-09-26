export const MINIO_CLIENT = 'MINIO_CLIENT';

export const AVATAR_FIELD_NAME = 'avatar';
export const AVATAR_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const COURSE_THUMBNAIL_FIELD_NAME = 'thumbnail';
export const COURSE_THUMBNAIL_MAX_SIZE_BYTES = 5 * 1024 * 1024;
export const COURSE_THUMBNAIL_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
];

export const LESSON_VIDEO_FIELD_NAME = 'video';
export const LESSON_VIDEO_MAX_SIZE_BYTES = 200 * 1024 * 1024;
export const LESSON_VIDEO_ALLOWED_MIME_TYPES = ['video/mp4', 'video/webm'];

export const LESSON_MATERIAL_FIELD_NAME = 'material';
export const LESSON_MATERIAL_MAX_SIZE_BYTES = 20 * 1024 * 1024;
export const LESSON_MATERIAL_ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
];

export const QUIZ_EXCEL_FIELD_NAME = 'file';
export const QUIZ_EXCEL_MAX_SIZE_BYTES = 2 * 1024 * 1024;
export const QUIZ_EXCEL_EXTENSION = '.xlsx';
