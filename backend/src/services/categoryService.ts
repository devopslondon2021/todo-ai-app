import { getSupabase } from '../config/supabase';
import type { Category } from '../types';

export async function getCategories(userId: string): Promise<Category[]> {
  const { data, error } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data || [];
}

export async function getCategoryById(id: string): Promise<Category | null> {
  const { data, error } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('id', id)
    .single();

  if (error) return null;
  return data;
}

export async function getCategoryByName(userId: string, name: string): Promise<Category | null> {
  const { data } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .ilike('name', name)
    .single();

  return data;
}

export async function createCategory(data: {
  user_id: string;
  name: string;
  color?: string;
  icon?: string;
  parent_id?: string;
}): Promise<Category> {
  const { data: category, error } = await getSupabase()
    .from('categories')
    .insert(data)
    .select('*')
    .single();

  if (error) throw error;
  return category;
}

export async function updateCategory(id: string, updates: Partial<Category>): Promise<Category> {
  const { data, error } = await getSupabase()
    .from('categories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCategory(id: string): Promise<void> {
  const { error } = await getSupabase().from('categories').delete().eq('id', id);
  if (error) throw error;
}

/** Fetch flat list and build a tree in memory */
export async function getCategoryTree(userId: string): Promise<Category[]> {
  const all = await getCategories(userId);
  const map = new Map<string, Category>();
  const roots: Category[] = [];

  // Initialize all nodes with empty children arrays
  for (const cat of all) {
    map.set(cat.id, { ...cat, children: [] });
  }

  // Build tree
  for (const cat of all) {
    const node = map.get(cat.id)!;
    if (cat.parent_id && map.has(cat.parent_id)) {
      map.get(cat.parent_id)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

/** Resolve category + subcategory names to a category_id */
export async function resolveCategoryPath(
  userId: string,
  categoryName: string | null,
  subcategoryName: string | null
): Promise<string | undefined> {
  // Default to "Personal" if no category provided
  const resolvedName = categoryName || 'Personal';

  // Find parent by name (root level)
  const { data: parent } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .is('parent_id', null)
    .ilike('name', resolvedName)
    .single();

  if (!parent) return undefined;

  if (!subcategoryName) return parent.id;

  // Find child by name under parent
  const { data: child } = await getSupabase()
    .from('categories')
    .select('*')
    .eq('user_id', userId)
    .eq('parent_id', parent.id)
    .ilike('name', subcategoryName)
    .single();

  return child?.id || parent.id;
}
