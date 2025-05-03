import { Buffer } from "node:buffer";
import { writeFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

import puppeteer, { type Browser, type Page } from "puppeteer";
import pLimit from "p-limit";
import { PDFDocument } from "pdf-lib";
import chromeFinder from "chrome-finder";

function showHelp() {
	console.log(`
Usage: site2pdf-cli [--url-list <file_path>] [--output <filename>] <main_url> [url_pattern]

Arguments:
  --url-list       Path to a text file containing a list of URLs to process (one URL per line)
  --output         Specify a custom output filename for the PDF (e.g., "report.pdf"). Files are saved in the "out" directory
  main_url         The main URL to generate PDF from
  url_pattern      (Optional) Regular expression pattern to match sub-links (default: ^main_url)

Examples:
  # Crawl a website
  site2pdf-cli https://example.com
  
  # Use URLs from a file
  site2pdf-cli --url-list urls.txt https://example.com
  
  # Specify custom output filename
  site2pdf-cli --output my-report.pdf https://example.com
  
  # Combine options
  site2pdf-cli --url-list urls.txt --output custom-report.pdf https://example.com
`);
}

type BrowserContext = {
	browser: Browser,
	page: Page,
};

async function useBrowserContext() {
	const browser = await puppeteer.launch({
		headless: true,
		executablePath: chromeFinder(),
	});
	const page = (await browser.pages())[0];
	return {
		browser,
		page
	};
}

export async function generatePDF(
	ctx: BrowserContext,
	url: string,
	urlPattern: RegExp = new RegExp(`^${url}`),
	concurrentLimit: number,
	predefinedURLs?: string[],
): Promise<{ pdfBuffer: Buffer; failedUrls: string[] }> {
	const limit = pLimit(concurrentLimit);
	const failedUrls: string[] = [];
	
	let uniqueSubLinks: string[];
	
	// If predefined URLs are provided, use them instead of crawling
	if (predefinedURLs && predefinedURLs.length > 0) {
		// Normalize predefined URLs to remove fragments and trailing slashes
		uniqueSubLinks = predefinedURLs.map(link => normalizeURL(link));
		console.log(`Using ${uniqueSubLinks.length} predefined URLs instead of crawling`);
	} else {
		// Crawl the website to find links
		const page = await ctx.browser.newPage();
		await page.goto(url, { waitUntil: 'domcontentloaded' });

		const subLinks = await page.evaluate((patternString) => {
			const pattern = new RegExp(patternString);
			const links = Array.from(document.querySelectorAll("a"));
			return links.map((link) => link.href).filter((href) => pattern.test(href));
		}, urlPattern.source);

		const subLinksWithoutAnchors = subLinks.map((link) => normalizeURL(link));
		uniqueSubLinks = Array.from(new Set(subLinksWithoutAnchors));

		if (!uniqueSubLinks.includes(url)) {
			uniqueSubLinks.unshift(url);
		}
	}

	const pdfDoc = await PDFDocument.create();

	const generatePDFForPage = async (link: string) => {
		console.log(`loading ${link}`);
		const newPage = await ctx.browser.newPage();
		let pdfBytes;
		try {
			await newPage.goto(link, { waitUntil: 'domcontentloaded' });
			pdfBytes = await newPage.pdf({ format: "A4" });
			console.log(`Generated PDF for ${link}`);
			return Buffer.from(pdfBytes);
		} catch (error) {
			console.warn(`Warning: Error occurred while processing ${link}: ${error}`);
			failedUrls.push(link);
			return null;
		} finally {
			await newPage.close();
		}
	};
	
	const pdfPromises = uniqueSubLinks.map((link) =>
		limit(() => generatePDFForPage(link)),
	);
	
	// Get all the PDF bytes, remove null values
	const results = await Promise.all(pdfPromises);
	const pdfBytesArray: Buffer[] = [];
	
	// Explicitly check for null values
	for (const result of results) {
		if (result !== null) {
			pdfBytesArray.push(result);
		}
	}

	for (const pdfBytes of pdfBytesArray) {
		// Use direct Uint8Array conversion
		const pdfData = new Uint8Array(pdfBytes);
		const subPdfDoc = await PDFDocument.load(pdfData);
		const copiedPages = await pdfDoc.copyPages(
			subPdfDoc,
			subPdfDoc.getPageIndices(),
		);
		for (const page of copiedPages) {
			pdfDoc.addPage(page);
		}
	}

	const pdfBytes = await pdfDoc.save();
	const pdfBuffer = Buffer.from(pdfBytes);

	return { pdfBuffer, failedUrls };
}

export function generateSlug(url: string): string {
	return url
		.replace(/https?:\/\//, "")
		.replace(/[^\w\s-]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/\./g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.toLowerCase();
}

export function normalizeURL(url: string): string {
	const urlWithoutAnchor = url.split("#")[0];
	return urlWithoutAnchor.endsWith("/")
		? urlWithoutAnchor.slice(0, -1)
		: urlWithoutAnchor;
}

/**
 * Reads a list of URLs from a text file
 * @param filePath Path to the text file containing URLs (one per line)
 * @returns Array of URLs
 */
export async function readURLsFromFile(filePath: string): Promise<string[]> {
	try {
		if (!existsSync(filePath)) {
			throw new Error(`URL list file not found: ${filePath}`);
		}
		
		const fileContent = readFileSync(filePath, 'utf8');
		const urls = fileContent
			.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0 && !line.startsWith('#'));
		
		// Basic validation of URLs
		const invalidUrls = urls.filter(url => {
			try {
				new URL(url);
				return false;
			} catch {
				return true;
			}
		});
				if (invalidUrls.length > 0) {
			console.warn(`Warning: Found ${invalidUrls.length} invalid URLs in the file:`);
			invalidUrls.forEach(url => console.warn(`- ${url}`));
		}		
		return urls.filter(url => !invalidUrls.includes(url));
	} catch (error: unknown) {
		// Fix error handling - ensure we're safely accessing error.message by checking type
		let errorMessage: string;
		if (error instanceof Error) {
			errorMessage = error.message;
		} else {
			errorMessage = String(error);
		}
		throw new Error(`Failed to read URL list: ${errorMessage}`);
	}
}

export async function main() {
	// Parse command line arguments
	const args = process.argv.slice(2);
	
	// Check for invalid switches (arguments starting with "--" that aren't recognized)
	const validSwitches = ['--url-list', '--output'];
	const invalidSwitches = args.filter(arg => 
		arg.startsWith('--') && !validSwitches.includes(arg)
	);
	
	if (invalidSwitches.length > 0) {
		console.error(`Error: Invalid switch(es) detected: ${invalidSwitches.join(', ')}`);
		showHelp();
		return; // Exit early
	}

	let urlListPath: string | null = null;
	let customOutputFile: string | null = null;
	let mainURL: string | undefined;
	let urlPatternStr: string | undefined;
	
	// Check for --url-list parameter
	const urlListIndex = args.indexOf('--url-list');
	if (urlListIndex !== -1 && urlListIndex + 1 < args.length) {
		urlListPath = args[urlListIndex + 1];
		// Remove --url-list and its value from args
		args.splice(urlListIndex, 2);
	}
	
	// Check for --output parameter
	const outputIndex = args.indexOf('--output');
	if (outputIndex !== -1 && outputIndex + 1 < args.length) {
		customOutputFile = args[outputIndex + 1];
		// Remove --output and its value from args
		args.splice(outputIndex, 2);
		
		// Ensure the filename ends with .pdf
		if (!customOutputFile.toLowerCase().endsWith('.pdf')) {
			customOutputFile += '.pdf';
		}
	}
		// Remaining args are mainURL and urlPattern
	[mainURL, urlPatternStr] = args;
	
	// URL is still required as a base for the output filename even in url-list mode
	if (!mainURL) {
		console.error("Error: <main_url> is required");
		showHelp();
		return; // Exit early instead of throwing an error
	}
	
	const urlPattern = urlPatternStr
		? new RegExp(urlPatternStr)
		: new RegExp(`^${mainURL}`);
	let predefinedURLs: string[] | undefined;
	if (urlListPath) {
		console.log(`Reading URLs from file: ${urlListPath}`);
		try {
			predefinedURLs = await readURLsFromFile(urlListPath);
			console.log(`Found ${predefinedURLs.length} URLs in the file`);
		} catch (error) {
			console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
			showHelp();
			return; // Exit early
		}
	}
	
	if (predefinedURLs && predefinedURLs.length > 0) {
		console.log(`Generating PDF from ${predefinedURLs.length} predefined URLs`);
	} else {
		console.log(`Generating PDF for ${mainURL} and sub-links matching ${urlPattern}`);
	}
	
	let ctx;
	try {
		ctx = await useBrowserContext();		const { pdfBuffer, failedUrls } = await generatePDF(ctx, mainURL, urlPattern, cpus().length, predefinedURLs);
		
		// Generate output filename either from custom name or URL slug
		const outputDir = join(process.cwd(), "out");
		const outputFilename = customOutputFile || `${generateSlug(mainURL)}.pdf`;
		const outputPath = join(outputDir, outputFilename);
		
		// Generate log filename by removing .pdf extension and adding .log
		const logBasename = outputFilename.toLowerCase().endsWith('.pdf') 
			? outputFilename.slice(0, -4) + '.log'
			: outputFilename + '.log';
		const logPath = join(outputDir, logBasename);

		if (!existsSync(outputDir)) {
			mkdirSync(outputDir, { recursive: true });
		}

		writeFileSync(outputPath, new Uint8Array(pdfBuffer));
		console.log(`PDF successfully saved to ${outputPath}`);
				// Save failed URLs to log file if there are any
		if (failedUrls.length > 0) {
			console.warn(`Warning: ${failedUrls.length} URLs failed to process. See log file: ${logPath}`);
			const logContent = failedUrls.join('\n');
			writeFileSync(logPath, logContent);
			
			// Also log the failed URLs to the console
			failedUrls.forEach(url => console.warn(`- ${url}`));
		}
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.error("Error generating PDF:", errorMessage);
	} finally {
		ctx?.browser.close();
	}
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main();
}
