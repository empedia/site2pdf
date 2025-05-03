import fs from "node:fs";
import { join } from "node:path";
import type { Browser } from "puppeteer";
import { jest } from "@jest/globals";
import { generatePDF, readURLsFromFile } from "../src/index";
import { Writable } from "node:stream";

describe("readURLsFromFile", () => {
  // Create a temporary test file
  const testFilePath = join(process.cwd(), "tests", "fixtures", "test-urls.txt");
  
  beforeEach(() => {
    // Create test file with URLs
    const urls = [
      "https://example.com",
      "https://example.com/page1",
      "# This is a comment",
      "https://example.com/page2",
      "",
      "https://example.com/page3",
      "invalid-url"
    ].join("\n");
    
    fs.writeFileSync(testFilePath, urls);
  });
  
  afterEach(() => {
    // Clean up test file
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });
  
  it("should read valid URLs from a file and filter out comments and invalid URLs", async () => {
    const urls = await readURLsFromFile(testFilePath);
    
    expect(urls).toHaveLength(4);
    expect(urls).toContain("https://example.com");
    expect(urls).toContain("https://example.com/page1");
    expect(urls).toContain("https://example.com/page2");
    expect(urls).toContain("https://example.com/page3");
    expect(urls).not.toContain("# This is a comment");
    expect(urls).not.toContain("invalid-url");
  });
  
  it("should throw an error if the file doesn't exist", async () => {
    await expect(readURLsFromFile("non-existent-file.txt")).rejects.toThrow();
  });
});

describe("generatePDF with predefined URLs", () => {
  let mockConsoleWarn: ReturnType<typeof jest.spyOn>;
  
  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
    mockConsoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  
  afterAll(() => {
    (console.log as jest.Mock).mockRestore();
    mockConsoleWarn.mockRestore();
  });
  
  it("should generate a PDF using predefined URLs", async () => {
    const predefinedURLs = [
      "https://example.com/page1",
      "https://example.com/page2",
      "https://example.com/page3",
    ];
    
    const mockBrowser = {
      newPage: async () => ({
        evaluate: async () => [], // This shouldn't be called when using predefined URLs
        pdf: async () => {
          const fixturePath = join(
            process.cwd(),
            "tests",
            "fixtures",
            "sample.pdf",
          );
          return Buffer.from(fs.readFileSync(fixturePath));
        },
        goto: async () => {},
        close: async () => {},
      }),
      close: async () => {},
    } as unknown as Browser;
    
    const ctx = {
      browser: mockBrowser,
      page: await mockBrowser.newPage(),
    };
    
    const url = "https://example.com"; // Base URL still needed for reference
    const urlPattern = new RegExp(`^${url}`);
    const pdfBuffer = await generatePDF(
      ctx,
      url,
      urlPattern,
      2,
      predefinedURLs
    );
    
    expect(pdfBuffer).toBeInstanceOf(Buffer);
  });
});
