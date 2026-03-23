import { isBookmark, type Bookmark } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile } from "./jsonFile";

export class BookmarksStore {
  constructor(private readonly filePath: string) {}

  async ensure(): Promise<void> {
    await ensureJsonFile(this.filePath, [] as Bookmark[]);
  }

  async list(): Promise<Bookmark[]> {
    const data = await readJsonFile(this.filePath);

    if (!Array.isArray(data) || !data.every(isBookmark)) {
      throw new Error(`Invalid bookmarks data in ${this.filePath}`);
    }

    return data;
  }

  async getById(bookmarkId: string): Promise<Bookmark | null> {
    const bookmarks = await this.list();
    return bookmarks.find((bookmark) => bookmark.id === bookmarkId) ?? null;
  }
}
