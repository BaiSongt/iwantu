/*
  Warnings:

  - You are about to alter the column `rating` on the `reviews` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Integer`.
  - Added the required column `title` to the `reviews` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'published',
ADD COLUMN     "title" TEXT NOT NULL,
ALTER COLUMN "rating" SET DATA TYPE INTEGER;
