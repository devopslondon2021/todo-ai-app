-- Migration V2: Subcategories, Smart Dedup, Default Due Dates
-- Run this in the Supabase SQL Editor AFTER schema.sql

-- 1. Add parent_id to categories for hierarchical subcategories (max 3 levels)
ALTER TABLE categories ADD COLUMN parent_id UUID REFERENCES categories(id) ON DELETE CASCADE;

-- 2. Replace unique constraint: allow same name under different parents
ALTER TABLE categories DROP CONSTRAINT categories_user_id_name_key;

-- Use a nil UUID sentinel for root categories so UNIQUE works properly
CREATE UNIQUE INDEX idx_categories_unique_name
  ON categories (user_id, LOWER(name), COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'));

-- 3. Depth enforcement trigger — prevents nesting beyond 3 levels
CREATE OR REPLACE FUNCTION check_category_depth()
RETURNS TRIGGER AS $$
DECLARE
  depth INT := 1;
  current_parent UUID := NEW.parent_id;
BEGIN
  WHILE current_parent IS NOT NULL LOOP
    depth := depth + 1;
    IF depth > 3 THEN
      RAISE EXCEPTION 'Categories cannot be nested more than 3 levels deep';
    END IF;
    SELECT parent_id INTO current_parent FROM categories WHERE id = current_parent;
  END LOOP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_category_depth
  BEFORE INSERT OR UPDATE ON categories
  FOR EACH ROW
  WHEN (NEW.parent_id IS NOT NULL)
  EXECUTE FUNCTION check_category_depth();

-- 4. Enable pg_trgm extension for fuzzy text similarity
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 5. Trigram index on tasks.title for fast similarity search
CREATE INDEX idx_tasks_title_trgm ON tasks USING gin (title gin_trgm_ops);

-- 6. RPC function: find similar tasks for duplicate detection
CREATE OR REPLACE FUNCTION find_similar_tasks(
  p_user_id UUID,
  p_title TEXT,
  p_threshold REAL DEFAULT 0.3
)
RETURNS TABLE (
  id UUID,
  title TEXT,
  similarity_score REAL
) AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.title, similarity(t.title, p_title) AS similarity_score
  FROM tasks t
  WHERE t.user_id = p_user_id
    AND t.status IN ('pending', 'in_progress')
    AND similarity(t.title, p_title) > p_threshold
  ORDER BY similarity_score DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;

-- 7. Index on parent_id for efficient tree queries
CREATE INDEX idx_categories_parent_id ON categories(parent_id);
