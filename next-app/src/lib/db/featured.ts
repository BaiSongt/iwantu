/**
 * Featured Items Data Access Layer
 *
 * Handles fetching active featured items from the FeaturedItem table.
 * Featured items reference other entities (products, agents, companies, solutions, teams)
 * by itemType + itemId.
 */

import prisma from './client';

/**
 * A featured item row from the database.
 * The `itemType` field indicates what kind of entity the `itemId` refers to.
 */
export interface FeaturedItemRow {
  id: string;
  itemType: 'product' | 'agent' | 'company' | 'solution' | 'team';
  itemId: string;
  title: string;
  description: string | null;
  position: number;
  active: boolean;
  createdAt: Date;
}

/**
 * Fetch all currently active featured items, ordered by position.
 *
 * @returns Array of active FeaturedItemRow objects
 */
export async function getFeaturedItems(): Promise<FeaturedItemRow[]> {
  try {
    const rows = await prisma.featuredItem.findMany({
      where: { active: true },
      orderBy: { position: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      itemType: row.itemType as FeaturedItemRow['itemType'],
      itemId: row.itemId,
      title: row.title,
      description: row.description,
      position: row.position,
      active: row.active,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error('[DAL] getFeaturedItems failed:', error);
    return [];
  }
}

/**
 * Fetch active featured items of a specific type.
 *
 * @param itemType - The type of featured item to retrieve
 * @returns Array of active FeaturedItemRow objects of the given type
 */
export async function getFeaturedItemsByType(
  itemType: FeaturedItemRow['itemType'],
): Promise<FeaturedItemRow[]> {
  try {
    const rows = await prisma.featuredItem.findMany({
      where: { active: true, itemType },
      orderBy: { position: 'asc' },
    });

    return rows.map((row) => ({
      id: row.id,
      itemType: row.itemType as FeaturedItemRow['itemType'],
      itemId: row.itemId,
      title: row.title,
      description: row.description,
      position: row.position,
      active: row.active,
      createdAt: row.createdAt,
    }));
  } catch (error) {
    console.error('[DAL] getFeaturedItemsByType failed:', error);
    return [];
  }
}
