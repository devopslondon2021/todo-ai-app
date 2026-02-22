import { getSupabase } from '../config/supabase.js';

const PARENT_CATEGORY_NAME = 'Videos';
const OLD_CATEGORY_NAME = 'Videos to Watch';

/** Decode HTML entities (named + numeric) from scraped titles */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

/** Clean and truncate a fetched title */
function cleanTitle(raw: string, maxLen = 80): string {
  let title = decodeHtmlEntities(raw).trim();
  title = title.replace(/\s+on Instagram:\s*/, ' — ');
  if (title.length > maxLen) title = title.slice(0, maxLen).trimEnd() + '…';
  return title;
}

interface VideoTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

// Track which users have been migrated this session
const migratedUsers = new Set<string>();

/** Lazily migrate old "Videos to Watch" → "Videos" with subcategories */
async function migrateVideosCategory(userId: string): Promise<void> {
  if (migratedUsers.has(userId)) return;
  migratedUsers.add(userId);

  const { data: oldCat } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .eq('name', OLD_CATEGORY_NAME)
    .single();

  if (!oldCat) return;

  // Rename to "Videos"
  await getSupabase()
    .from('categories')
    .update({ name: PARENT_CATEGORY_NAME })
    .eq('id', oldCat.id);

  // Create subcategories if they don't exist
  for (const sub of ['Instagram', 'YouTube']) {
    const { data: existing } = await getSupabase()
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .eq('parent_id', oldCat.id)
      .eq('name', sub)
      .single();

    if (!existing) {
      await getSupabase()
        .from('categories')
        .insert({ user_id: userId, parent_id: oldCat.id, name: sub });
    }
  }

  // Move existing tasks to appropriate subcategory based on [YT]/[IG] prefix
  const { data: subs } = await getSupabase()
    .from('categories')
    .select('id, name')
    .eq('user_id', userId)
    .eq('parent_id', oldCat.id);

  if (!subs) return;

  const igCat = subs.find(s => s.name === 'Instagram');
  const ytCat = subs.find(s => s.name === 'YouTube');

  const { data: tasks } = await getSupabase()
    .from('tasks')
    .select('id, title')
    .eq('user_id', userId)
    .eq('category_id', oldCat.id);

  if (!tasks) return;

  for (const task of tasks) {
    const targetCatId = task.title.startsWith('[YT]') ? ytCat?.id
      : task.title.startsWith('[IG]') ? igCat?.id
      : null;
    if (targetCatId) {
      await getSupabase()
        .from('tasks')
        .update({ category_id: targetCatId })
        .eq('id', task.id);
    }
  }

  console.log(`[VIDEO] Migrated ${tasks.length} videos for user ${userId}`);
}

/** Get or create the parent "Videos" category for a user */
async function getOrCreateParentCategory(userId: string): Promise<string> {
  const { data: existing } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .eq('name', PARENT_CATEGORY_NAME)
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await getSupabase()
    .from('categories')
    .insert({ user_id: userId, name: PARENT_CATEGORY_NAME })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

/** Get or create a video subcategory (Instagram or YouTube) under the parent */
async function getOrCreateVideoSubcategory(userId: string, platform: 'youtube' | 'instagram'): Promise<string> {
  // Run lazy migration first
  await migrateVideosCategory(userId);

  const parentId = await getOrCreateParentCategory(userId);
  const subName = platform === 'youtube' ? 'YouTube' : 'Instagram';

  const { data: existing } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('parent_id', parentId)
    .eq('name', subName)
    .single();

  if (existing) return existing.id;

  const { data: created, error } = await getSupabase()
    .from('categories')
    .insert({ user_id: userId, parent_id: parentId, name: subName })
    .select('id')
    .single();

  if (error) throw error;
  return created.id;
}

/** Fetch video title from oEmbed APIs, with HTML scraping fallback for Instagram */
export async function fetchVideoMetadata(url: string, platform: 'youtube' | 'instagram'): Promise<string> {
  // Try oEmbed first (works reliably for YouTube, occasionally for Instagram)
  try {
    const oembedUrl = platform === 'youtube'
      ? `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
      : `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`;

    const res = await fetch(oembedUrl, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json() as { title?: string; author_name?: string };
      if (platform === 'youtube' && data.title) return cleanTitle(data.title);
      // For Instagram, prefer author_name for a more descriptive title
      if (platform === 'instagram') {
        if (data.author_name) return cleanTitle(`${data.author_name}'s reel`);
        if (data.title) return cleanTitle(data.title);
      }
    }
  } catch {
    // Continue to fallback
  }

  // For Instagram: try scraping og:title / author meta from the page HTML
  if (platform === 'instagram') {
    try {
      const pageRes = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
          'Accept': 'text/html',
        },
      });
      if (pageRes.ok) {
        const html = await pageRes.text();

        // Try multiple meta patterns for author name
        const authorMatch =
          html.match(/<meta\s+(?:property|name)="(?:og:title|author)"\s+content="([^"]+)"/i) ||
          html.match(/<meta\s+content="([^"]+)"\s+(?:property|name)="(?:og:title|author)"/i);
        if (authorMatch) {
          const val = authorMatch[1];
          // "Author on Instagram: caption" → extract author name
          const authorExtract = val.match(/^(.+?)\s+on Instagram/);
          if (authorExtract) return cleanTitle(`${authorExtract[1]}'s reel`);
          return cleanTitle(val);
        }

        // Try og:description for author hints
        const descMatch = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]+)"/i);
        if (descMatch) {
          // Pattern: "123 likes, 45 comments - Author Name on ..."
          const descAuthor = descMatch[1].match(/comments\s*[-–—]\s*(.+?)\s+on/);
          if (descAuthor) return cleanTitle(`${descAuthor[1]}'s reel`);
        }

        // Also try the <title> tag
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        if (titleMatch) {
          const title = titleMatch[1].replace(/ \| Instagram$/, '').trim();
          if (title && title !== 'Instagram') return cleanTitle(title);
        }
      }
    } catch {
      // Continue to fallback
    }

    // Extract shortcode for a distinguishable fallback
    const shortcodeMatch = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
    const shortcode = shortcodeMatch?.[2] || '';
    return shortcode ? `Instagram Reel (${shortcode})` : 'Instagram Reel';
  }

  return 'YouTube Video';
}

/** Extract a quick title from URL without any network calls */
function quickTitle(url: string, platform: 'youtube' | 'instagram'): string {
  if (platform === 'youtube') {
    const idMatch = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]+)/);
    return idMatch ? `YouTube Video (${idMatch[1]})` : 'YouTube Video';
  }
  const shortcodeMatch = url.match(/\/(reel|p)\/([A-Za-z0-9_-]+)/);
  return shortcodeMatch ? `Instagram Reel (${shortcodeMatch[2]})` : 'Instagram Reel';
}

/** Save a video bookmark immediately with a quick title, returns the saved row */
export async function saveVideo(
  userId: string,
  url: string,
  platform: 'youtube' | 'instagram',
): Promise<{ id: string; title: string }> {
  const subcategoryId = await getOrCreateVideoSubcategory(userId, platform);

  const prefix = platform === 'youtube' ? '[YT]' : '[IG]';
  const fullTitle = `${prefix} ${quickTitle(url, platform)}`;

  const { data, error } = await getSupabase()
    .from('tasks')
    .insert({
      user_id: userId,
      title: fullTitle,
      description: url,
      priority: 'low',
      status: 'pending',
      category_id: subcategoryId,
    })
    .select('id, title')
    .single();

  if (error) throw error;
  return data;
}

/** Fetch metadata and update the video title in the background */
export async function enrichVideoTitle(videoId: string, url: string, platform: 'youtube' | 'instagram'): Promise<void> {
  try {
    const title = await fetchVideoMetadata(url, platform);
    const fallback = quickTitle(url, platform);
    if (title !== fallback) {
      const prefix = platform === 'youtube' ? '[YT]' : '[IG]';
      await getSupabase()
        .from('tasks')
        .update({ title: `${prefix} ${title}` })
        .eq('id', videoId);
    }
  } catch (err) {
    console.error('[VIDEO] enrichVideoTitle error:', err);
  }
}

/** Get all video subcategory IDs for a user (Instagram + YouTube) */
async function getVideoSubcategoryIds(userId: string): Promise<string[]> {
  const parentId = await getVideoParentCategoryId(userId);
  if (!parentId) return [];

  const { data: subs } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('parent_id', parentId);

  return subs?.map(s => s.id) || [];
}

/** Get all pending videos for a user (from all subcategories) */
export async function getVideos(userId: string): Promise<VideoTask[]> {
  const subIds = await getVideoSubcategoryIds(userId);
  if (subIds.length === 0) return [];

  const { data, error } = await getSupabase()
    .from('tasks')
    .select('id, title, description, status, created_at')
    .eq('user_id', userId)
    .in('category_id', subIds)
    .neq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return data || [];
}

/** Mark a video as watched (completed) */
export async function markVideoWatched(videoId: string): Promise<void> {
  await getSupabase()
    .from('tasks')
    .update({ status: 'completed' })
    .eq('id', videoId);
}

/** Get the parent "Videos" category ID if it exists (without creating) */
export async function getVideoParentCategoryId(userId: string): Promise<string | null> {
  const { data } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .is('parent_id', null)
    .eq('name', PARENT_CATEGORY_NAME)
    .single();

  return data?.id || null;
}

/** Get all video-related category IDs (parent + subcategories) */
export async function getAllVideoCategoryIds(userId: string): Promise<string[]> {
  const parentId = await getVideoParentCategoryId(userId);
  if (!parentId) return [];

  const { data: subs } = await getSupabase()
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .eq('parent_id', parentId);

  return [parentId, ...(subs?.map(s => s.id) || [])];
}
