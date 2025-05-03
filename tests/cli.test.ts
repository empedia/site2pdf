import { exec } from "node:child_process";
import { join } from "node:path";
import { describe, it, expect } from "@jest/globals";
import fs from "node:fs";

describe("CLI Integration Tests", () => {
	const localMainFile = join(process.cwd(), "tests", "fixtures", "index.html");
	
	it("should generate a PDF for a valid local file using the CLI", (done) => {
		const mainURL = `file://${localMainFile}`;
		const cliCommand = `node bin/site2pdf.js ${mainURL}`;
		exec(cliCommand, (error, stdout, stderr) => {			expect(error).toBeNull();
			expect(stderr).toBe("");
			expect(stdout).toContain("Generating PDF for");
			expect(stdout).toContain("PDF successfully saved to");
			expect(stdout).toContain("fixtures-index-html.pdf");
			done();
		});
	}, 30000);
	
	it("should generate a PDF with custom filename when using --output parameter", (done) => {
		const mainURL = `file://${localMainFile}`;
		const customFilename = `custom-test-output-${Date.now()}.pdf`;
		const cliCommand = `node bin/site2pdf.js --output ${customFilename} ${mainURL}`;
		
		exec(cliCommand, (error, stdout, stderr) => {			expect(error).toBeNull();
			expect(stderr).toBe("");
			expect(stdout).toContain("Generating PDF for");
			expect(stdout).toContain("PDF successfully saved to");
			expect(stdout).toContain(customFilename);
			
			// Clean up the test file
			const outputPath = join(process.cwd(), "out", customFilename);
			if (fs.existsSync(outputPath)) {
				fs.unlinkSync(outputPath);
			}
			
			done();
		});
	}, 30000);
	
	it("should append .pdf extension if not provided in --output parameter", (done) => {
		const mainURL = `file://${localMainFile}`;
		const baseFilename = `custom-test-output-${Date.now()}`;
		const expectedFilename = `${baseFilename}.pdf`;
		const cliCommand = `node bin/site2pdf.js --output ${baseFilename} ${mainURL}`;
		
		exec(cliCommand, (error, stdout, stderr) => {			expect(error).toBeNull();
			expect(stderr).toBe("");
			expect(stdout).toContain("Generating PDF for");
			expect(stdout).toContain("PDF successfully saved to");
			expect(stdout).toContain(expectedFilename);
			
			// Clean up the test file
			const outputPath = join(process.cwd(), "out", expectedFilename);
			if (fs.existsSync(outputPath)) {
				fs.unlinkSync(outputPath);
			}
			
			done();
		});
	}, 30000);
});
