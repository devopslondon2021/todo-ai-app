-- Migration V6: Restructure video categories
-- Renames "Videos to Watch" → "Videos". Subcategories (Instagram, YouTube) are
-- created lazily by the app on first video save per user.
-- Run this in the Supabase SQL Editor.

UPDATE categories SET name = 'Videos' WHERE name = 'Videos to Watch';
