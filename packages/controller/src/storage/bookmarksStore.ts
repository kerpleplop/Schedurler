import { isBookmark, type Bookmark } from "@schedurler/shared";
import { ensureJsonFile, readJsonFile } from "./jsonFile";

const DEFAULT_BOOKMARKS: Bookmark[] = [
  {
    id: "schedurler-focus-timer",
    name: "Focus Timer",
    url: "https://example.com/focus-timer",
    keywords: ["focus", "timer"]
  },
  {
    id: "schedurler-daily-brief",
    name: "Daily Brief",
    url: "https://example.com/daily-brief",
    keywords: ["news", "reading"]
  },
  {
    id: "schedurler-background-mix",
    name: "Background Mix",
    url: "https://example.com/background-mix",
    keywords: ["audio", "music"]
  }
];

export class BookmarksStore {
  constructor(private readonly filePath: string) {}

  async ensure(): Promise<void> {
    await ensureJsonFile(this.filePath, DEFAULT_BOOKMARKS);
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
