import { randomUUID } from "node:crypto";
import { isBookmark, type Bookmark } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile, writeJsonFile } from "./jsonFile";

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

  async create(data: {
    name: string;
    url: string;
    keywords: string[];
  }): Promise<Bookmark> {
    const bookmarks = await this.list();
    const bookmark: Bookmark = { id: randomUUID(), ...data };
    await writeJsonFile(this.filePath, [...bookmarks, bookmark]);
    return bookmark;
  }

  async update(
    id: string,
    patch: { name?: string; url?: string; keywords?: string[] }
  ): Promise<Bookmark | null> {
    const bookmarks = await this.list();
    const index = bookmarks.findIndex((b) => b.id === id);

    if (index === -1) {
      return null;
    }

    const updated = { ...bookmarks[index], ...patch };
    bookmarks[index] = updated;
    await writeJsonFile(this.filePath, bookmarks);
    return updated;
  }

  async remove(id: string): Promise<boolean> {
    const bookmarks = await this.list();
    const index = bookmarks.findIndex((b) => b.id === id);

    if (index === -1) {
      return false;
    }

    bookmarks.splice(index, 1);
    await writeJsonFile(this.filePath, bookmarks);
    return true;
  }
}
