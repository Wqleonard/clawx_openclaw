import type { FilePreviewKind } from './types';

export const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdx'] as const;
export const TEXT_EXTENSIONS = ['.txt'] as const;

export const IMAGE_EXTENSIONS = [
  '.apng',
  '.avif',
  '.bmp',
  '.gif',
  '.ico',
  '.jfif',
  '.jpeg',
  '.jpg',
  '.pjpeg',
  '.pjp',
  '.png',
  '.svg',
  '.tif',
  '.tiff',
  '.webp',
] as const;

export const PDF_EXTENSIONS = ['.pdf'] as const;
export const DOCUMENT_EXTENSIONS = ['.doc', '.docx'] as const;
export const PRESENTATION_EXTENSIONS = ['.ppt', '.pptx'] as const;

function hasAnyExtension(filePath: string, extensions: readonly string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function getPreviewKind(filePath: string | null): FilePreviewKind {
  if (!filePath) return 'none';
  if (hasAnyExtension(filePath, MARKDOWN_EXTENSIONS)) return 'markdown';
  if (hasAnyExtension(filePath, TEXT_EXTENSIONS)) return 'text';
  if (hasAnyExtension(filePath, IMAGE_EXTENSIONS)) return 'image';
  if (hasAnyExtension(filePath, PDF_EXTENSIONS)) return 'pdf';
  if (hasAnyExtension(filePath, DOCUMENT_EXTENSIONS)) return 'document';
  if (hasAnyExtension(filePath, PRESENTATION_EXTENSIONS)) return 'presentation';
  return 'unsupported';
}

export function getFileName(filePath: string): string {
  const normalized = filePath.replace(/[\\/]+/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || filePath;
}

export function getMimeTypeByPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.doc')) return 'application/msword';
  if (lower.endsWith('.docx')) {
    return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  }
  if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
  if (lower.endsWith('.pptx')) {
    return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  }
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.jfif')) {
    return 'image/jpeg';
  }
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.ico')) return 'image/x-icon';
  if (lower.endsWith('.avif')) return 'image/avif';
  if (lower.endsWith('.apng')) return 'image/apng';
  if (lower.endsWith('.tif') || lower.endsWith('.tiff')) return 'image/tiff';
  return 'application/octet-stream';
}
